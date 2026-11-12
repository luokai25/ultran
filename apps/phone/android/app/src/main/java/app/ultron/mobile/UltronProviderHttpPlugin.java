package app.ultron.mobile;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Device-to-provider HTTPS transport. The WebView origin is https://localhost, so
 * browser fetch would be subject to each provider's CORS policy; this plugin makes
 * the request natively instead. It is deliberately narrow: HTTPS only, an explicit
 * provider host allowlist, and an explicit request-header allowlist. Protocol
 * handling (request bodies, SSE parsing, model lists) stays in the TypeScript
 * adapters in src/provider-adapters.ts.
 */
@CapacitorPlugin(name = "UltronProviderHttp")
public final class UltronProviderHttpPlugin extends Plugin {
    private static final Set<String> ALLOWED_HOSTS = new HashSet<>(Arrays.asList(
        "openrouter.ai",
        "api.mistral.ai",
        "api.cerebras.ai",
        "api.groq.com",
        "api.cohere.com",
        "generativelanguage.googleapis.com"
    ));
    private static final Set<String> ALLOWED_HEADERS = new HashSet<>(Arrays.asList(
        "authorization", "content-type", "accept", "http-referer", "x-title"
    ));
    private static final int MAX_BODY_BYTES = 1_500_000;
    private static final int MAX_PLAIN_RESPONSE_CHARS = 2_000_000;
    private static final int MAX_ERROR_CHARS = 4_000;

    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final ConcurrentHashMap<String, HttpURLConnection> active = new ConcurrentHashMap<>();
    private final Set<String> cancelled = ConcurrentHashMap.newKeySet();

    private static URL validatedUrl(String raw) throws Exception {
        URL url = new URL(raw);
        String host = url.getHost().toLowerCase(Locale.ROOT);
        if (!"https".equalsIgnoreCase(url.getProtocol()) || !ALLOWED_HOSTS.contains(host)
            || url.getUserInfo() != null || (url.getPort() != -1 && url.getPort() != 443)) {
            throw new IllegalArgumentException("This provider endpoint is not supported by ULTRON.");
        }
        return url;
    }

    @PluginMethod
    public void request(PluginCall call) {
        final String rawUrl = call.getString("url", "");
        final String method = call.getString("method", "GET").toUpperCase(Locale.ROOT);
        final String body = call.getString("body");
        final boolean stream = Boolean.TRUE.equals(call.getBoolean("stream", false));
        final String requestId = call.getString("requestId", "");
        final JSObject headers = call.getObject("headers", new JSObject());
        final URL url;
        try {
            url = validatedUrl(rawUrl);
            if (!"GET".equals(method) && !"POST".equals(method)) throw new IllegalArgumentException("Unsupported provider request method.");
            if (body != null && body.getBytes(StandardCharsets.UTF_8).length > MAX_BODY_BYTES) throw new IllegalArgumentException("The provider request is too large.");
            if (stream && (requestId.isEmpty() || requestId.length() > 80)) throw new IllegalArgumentException("A streaming provider request needs a request id.");
        } catch (Exception error) {
            call.reject(error.getMessage() == null ? "Invalid provider request." : error.getMessage());
            return;
        }
        executor.execute(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) url.openConnection();
                if (!requestId.isEmpty()) active.put(requestId, connection);
                connection.setRequestMethod(method);
                connection.setConnectTimeout(20_000);
                connection.setReadTimeout(120_000);
                connection.setInstanceFollowRedirects(false);
                Iterator<String> names = headers.keys();
                while (names.hasNext()) {
                    String name = names.next();
                    String value = headers.getString(name);
                    if (value == null || !ALLOWED_HEADERS.contains(name.toLowerCase(Locale.ROOT))
                        || value.length() > 8_200 || value.indexOf('\n') >= 0 || value.indexOf('\r') >= 0) {
                        throw new IllegalArgumentException("A provider request header is not allowed.");
                    }
                    connection.setRequestProperty(name, value);
                }
                if ("POST".equals(method) && body != null) {
                    byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                    connection.setDoOutput(true);
                    connection.setFixedLengthStreamingMode(bytes.length);
                    try (OutputStream output = connection.getOutputStream()) { output.write(bytes); output.flush(); }
                }
                int status = connection.getResponseCode();
                String retryAfter = connection.getHeaderField("Retry-After");
                boolean success = status >= 200 && status < 300;
                JSObject result = new JSObject();
                result.put("status", status);
                result.put("retryAfter", retryAfter == null ? "" : retryAfter);
                if (stream && success) {
                    try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                        char[] buffer = new char[2048];
                        int read;
                        while ((read = reader.read(buffer)) != -1) {
                            if (read > 0) notifyListeners("providerStreamChunk", new JSObject().put("requestId", requestId).put("chunk", new String(buffer, 0, read)));
                        }
                    }
                    result.put("body", "");
                } else {
                    InputStream source = success ? connection.getInputStream() : connection.getErrorStream();
                    int limit = success ? MAX_PLAIN_RESPONSE_CHARS : MAX_ERROR_CHARS;
                    StringBuilder text = new StringBuilder();
                    if (source != null) {
                        try (BufferedReader reader = new BufferedReader(new InputStreamReader(source, StandardCharsets.UTF_8))) {
                            char[] buffer = new char[4096];
                            int read;
                            while ((read = reader.read(buffer)) != -1 && text.length() < limit) text.append(buffer, 0, read);
                        }
                    }
                    result.put("body", text.toString());
                }
                call.resolve(result);
            } catch (Exception error) {
                boolean wasCancelled = !requestId.isEmpty() && cancelled.contains(requestId);
                call.reject(wasCancelled ? "cancelled" : (error.getMessage() == null ? "The provider request failed." : error.getMessage()));
            } finally {
                if (!requestId.isEmpty()) { active.remove(requestId); cancelled.remove(requestId); }
                if (connection != null) connection.disconnect();
            }
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String requestId = call.getString("requestId", "");
        HttpURLConnection connection = requestId.isEmpty() ? null : active.get(requestId);
        if (connection != null) { cancelled.add(requestId); connection.disconnect(); }
        call.resolve(new JSObject().put("cancelled", connection != null));
    }
}
