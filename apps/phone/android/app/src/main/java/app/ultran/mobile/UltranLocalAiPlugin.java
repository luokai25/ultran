package app.ultran.mobile;

import android.app.ActivityManager;
import android.content.Intent;
import android.content.ClipData;
import android.database.Cursor;
import android.net.Uri;
import android.os.StatFs;
import android.os.Build;
import android.os.Debug;
import android.provider.OpenableColumns;

import com.getcapacitor.annotation.ActivityCallback;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.ArrayList;
import java.util.List;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "UltranLocalAI")
public class UltranLocalAiPlugin extends Plugin {
    // One queue serializes model imports, load/unload, inference and deletion so
    // a file can never be replaced or removed while native code is reading it.
    private final ExecutorService inferenceExecutor = Executors.newSingleThreadExecutor();
    private volatile String loadedModelPath;
    private volatile int loadedContextTokens;
    private volatile boolean loadedLargeModelMode;
    private static final long MAX_MODEL_BYTES = 256L * 1024L * 1024L * 1024L;
    private static final Pattern GGUF_SHARD = Pattern.compile("^(.+)-(\\d{5})-of-(\\d{5})\\.gguf$", Pattern.CASE_INSENSITIVE);

    private File modelDirectory() {
        File directory = new File(getContext().getFilesDir(), "models");
        if (!directory.exists() && !directory.mkdirs() && !directory.isDirectory()) {
            throw new IllegalStateException("Could not create the private model directory.");
        }
        return directory;
    }

    private String safeModelName(String name) {
        if (name == null || !name.toLowerCase().endsWith(".gguf") ||
                !name.matches("(?i)[A-Za-z0-9._ -]{1,160}\\.gguf")) {
            throw new IllegalArgumentException("Choose a GGUF model with a simple filename.");
        }
        return name;
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("supported", true);
        result.put("loaded", loadedModelPath != null);
        result.put("loadedModel", loadedModelPath == null ? "" : new File(loadedModelPath).getName());
        result.put("modelDirectory", modelDirectory().getAbsolutePath());
        result.put("runtimeVersion", NativeLlama.nativeVersion());
        call.resolve(result);
    }

    @PluginMethod
    public void getDeviceProfile(PluginCall call) {
        try {
            ActivityManager.MemoryInfo memory = new ActivityManager.MemoryInfo();
            ActivityManager manager = (ActivityManager) getContext().getSystemService(android.content.Context.ACTIVITY_SERVICE);
            if (manager != null) manager.getMemoryInfo(memory);
            StatFs storage = new StatFs(getContext().getFilesDir().getAbsolutePath());
            String[] abis = Build.SUPPORTED_ABIS;
            JSObject result = new JSObject();
            result.put("deviceModel", Build.MANUFACTURER + " " + Build.MODEL);
            result.put("totalRamBytes", memory.totalMem);
            result.put("availableRamBytes", memory.availMem);
            result.put("availableStorageBytes", storage.getAvailableBytes());
            result.put("cpuCores", Runtime.getRuntime().availableProcessors());
            result.put("abi", abis != null && abis.length > 0 ? abis[0] : "unknown");
            call.resolve(result);
        } catch (Exception error) {
            call.reject(error.getMessage() == null ? "Could not inspect device capabilities." : error.getMessage());
        }
    }

    @PluginMethod
    public void listModels(PluginCall call) {
        JSArray models = new JSArray();
        File[] files = modelDirectory().listFiles((dir, name) -> name.toLowerCase().endsWith(".gguf"));
        if (files != null) {
            for (File file : files) {
                Matcher shard = GGUF_SHARD.matcher(file.getName());
                if (shard.matches()) {
                    int index = Integer.parseInt(shard.group(2));
                    int count = Integer.parseInt(shard.group(3));
                    if (index != 1) continue;
                    long totalBytes = 0;
                    boolean complete = true;
                    String prefix = shard.group(1);
                    for (int part = 1; part <= count; part++) {
                        String partName = prefix + String.format(Locale.ROOT, "-%05d-of-%05d.gguf", part, count);
                        File partFile = new File(modelDirectory(), partName);
                        if (!partFile.isFile()) { complete = false; break; }
                        totalBytes += partFile.length();
                    }
                    if (!complete) continue;
                    JSObject item = new JSObject();
                    item.put("name", file.getName());
                    item.put("sizeBytes", totalBytes);
                    item.put("shards", count);
                    item.put("loaded", file.getAbsolutePath().equals(loadedModelPath));
                    models.put(item);
                    continue;
                }
                JSObject item = new JSObject();
                item.put("name", file.getName());
                item.put("sizeBytes", file.length());
                item.put("loaded", file.getAbsolutePath().equals(loadedModelPath));
                models.put(item);
            }
        }
        JSObject result = new JSObject();
        result.put("models", models);
        call.resolve(result);
    }

    @PluginMethod
    public void pickModel(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        startActivityForResult(call, intent, "handleModelPicked");
    }

    @ActivityCallback
    private void handleModelPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result == null || result.getResultCode() != android.app.Activity.RESULT_OK ||
                result.getData() == null) {
            call.resolve(new JSObject().put("cancelled", true));
            return;
        }
        ArrayList<Uri> selected = new ArrayList<>();
        ClipData clip = result.getData().getClipData();
        if (clip != null) {
            for (int i = 0; i < clip.getItemCount(); i++) {
                Uri item = clip.getItemAt(i).getUri();
                if (item != null) selected.add(item);
            }
        } else if (result.getData().getData() != null) {
            selected.add(result.getData().getData());
        }
        if (selected.isEmpty()) {
            call.resolve(new JSObject().put("cancelled", true));
            return;
        }
        inferenceExecutor.execute(() -> {
            if (selected.size() == 1) {
                Uri uri = selected.get(0);
                importSelectedModel(call, uri, queryDisplayName(uri));
            } else {
                importSelectedModelSet(call, selected);
            }
        });
    }

    private static final class SelectedShard {
        final Uri uri;
        final String name;
        final int index;
        final int count;
        SelectedShard(Uri uri, String name, int index, int count) {
            this.uri = uri; this.name = name; this.index = index; this.count = count;
        }
    }

    private void importSelectedModelSet(PluginCall call, List<Uri> uris) {
        ArrayList<File> partials = new ArrayList<>();
        ArrayList<File> finalized = new ArrayList<>();
        try {
            ArrayList<SelectedShard> shards = new ArrayList<>();
            Set<Integer> indices = new HashSet<>();
            String prefix = null;
            int expectedCount = -1;
            long totalReported = 0;
            for (Uri uri : uris) {
                String name = safeModelName(queryDisplayName(uri));
                Matcher matcher = GGUF_SHARD.matcher(name);
                if (!matcher.matches()) throw new IllegalStateException("Select every shard from one split GGUF set. Filenames must use the standard 00001-of-000NN pattern.");
                String currentPrefix = matcher.group(1);
                int index = Integer.parseInt(matcher.group(2));
                int count = Integer.parseInt(matcher.group(3));
                if (prefix == null) { prefix = currentPrefix; expectedCount = count; }
                if (!prefix.equalsIgnoreCase(currentPrefix) || expectedCount != count) {
                    throw new IllegalStateException("The selected files belong to different GGUF model sets.");
                }
                if (index < 1 || index > count || !indices.add(index)) {
                    throw new IllegalStateException("The selected GGUF set contains a duplicate or invalid shard number.");
                }
                long size = querySize(uri);
                if (size > 0) totalReported += size;
                shards.add(new SelectedShard(uri, name, index, count));
            }
            if (shards.size() != expectedCount || indices.size() != expectedCount) {
                throw new IllegalStateException("Incomplete GGUF set: selected " + shards.size() + " of " + expectedCount + " shards.");
            }
            shards.sort((a, b) -> Integer.compare(a.index, b.index));
            File directory = modelDirectory();
            StatFs storage = new StatFs(directory.getAbsolutePath());
            long availableAtStart = storage.getAvailableBytes();
            if (totalReported > MAX_MODEL_BYTES || (totalReported > 0 && totalReported > availableAtStart)) {
                throw new IllegalStateException("The complete model set exceeds Ultran's safety limit or available device storage.");
            }
            long totalCopied = 0;
            for (SelectedShard shard : shards) {
                File destination = new File(directory, shard.name);
                if (destination.exists()) throw new IllegalStateException("A shard named " + shard.name + " already exists. Delete or rename the old set before importing a replacement.");
                if (destination.getAbsolutePath().equals(loadedModelPath)) throw new IllegalStateException("Unload the active model before replacing it.");
                File partial = new File(directory, shard.name + ".partial");
                partials.add(partial);
                long copied = 0;
                long reported = querySize(shard.uri);
                try (InputStream input = getContext().getContentResolver().openInputStream(shard.uri);
                     FileOutputStream output = new FileOutputStream(partial)) {
                    if (input == null) throw new IllegalStateException("Could not open " + shard.name + ".");
                    byte[] buffer = new byte[1024 * 1024];
                    int read;
                    while ((read = input.read(buffer)) != -1) {
                        copied += read;
                        totalCopied += read;
                        if (totalCopied > MAX_MODEL_BYTES || totalCopied > availableAtStart) throw new IllegalStateException("The model set exceeded available storage while copying.");
                        output.write(buffer, 0, read);
                        JSObject progress = new JSObject();
                        progress.put("name", shard.name);
                        progress.put("copiedBytes", copied);
                        progress.put("totalBytes", reported);
                        notifyListeners("modelImportProgress", progress);
                    }
                    output.getFD().sync();
                }
                if (reported > 0 && copied != reported) throw new IllegalStateException("Incomplete shard: " + shard.name);
                if (copied < 1024L * 1024L) throw new IllegalStateException("Shard is unexpectedly small: " + shard.name);
                try (RandomAccessFile header = new RandomAccessFile(partial, "r")) {
                    byte[] magic = new byte[4]; header.readFully(magic);
                    if (magic[0] != 'G' || magic[1] != 'G' || magic[2] != 'U' || magic[3] != 'F') {
                        throw new IllegalStateException("Invalid GGUF header in " + shard.name + ".");
                    }
                }
            }
            for (int i = 0; i < shards.size(); i++) {
                File partial = partials.get(i);
                File destination = new File(directory, shards.get(i).name);
                if (!partial.renameTo(destination)) throw new IllegalStateException("Could not finalize the complete GGUF set; rolling back the import.");
                finalized.add(destination);
            }
            long totalBytes = 0;
            for (File file : finalized) totalBytes += file.length();
            call.resolve(new JSObject().put("cancelled", false)
                    .put("name", shards.get(0).name).put("sizeBytes", totalBytes)
                    .put("shards", shards.size()));
        } catch (Exception error) {
            for (File file : partials) if (file.exists()) file.delete();
            for (File file : finalized) if (file.exists()) file.delete();
            call.reject(error.getMessage() == null ? "GGUF shard-set import failed." : error.getMessage(), error);
        }
    }

    private void importSelectedModel(PluginCall call, Uri uri, String displayName) {
        File partial = null;
        try {
            String name = safeModelName(displayName);
            Matcher split = GGUF_SHARD.matcher(name);
            if (split.matches() && Integer.parseInt(split.group(3)) > 1) {
                throw new IllegalStateException("This is one shard of a split GGUF model. Select all numbered shards together so Ultran can verify and import the complete model.");
            }
            File destination = new File(modelDirectory(), name);
            if (destination.getAbsolutePath().equals(loadedModelPath)) {
                call.reject("Unload this model before replacing it.");
                return;
            }

            long reportedSize = querySize(uri);
            if (reportedSize > MAX_MODEL_BYTES) {
                call.reject("This model exceeds Ultran's 256 GB safety limit.");
                return;
            }
            StatFs storage = new StatFs(modelDirectory().getAbsolutePath());
            final long availableAtStart = storage.getAvailableBytes();
            if (reportedSize > 0 && reportedSize > availableAtStart) {
                call.reject("Not enough free device storage for this model.");
                return;
            }

            partial = new File(modelDirectory(), name + ".partial");
            long copied = 0;
            try (InputStream input = getContext().getContentResolver().openInputStream(uri);
                 FileOutputStream output = new FileOutputStream(partial)) {
                if (input == null) throw new IllegalStateException("Could not open the selected model.");
                byte[] buffer = new byte[1024 * 1024];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    output.write(buffer, 0, read);
                    copied += read;
                    if (copied > MAX_MODEL_BYTES || copied > availableAtStart) {
                        throw new IllegalStateException("The model exceeds Ultran's safety limit or available device storage.");
                    }
                    JSObject progress = new JSObject();
                    progress.put("name", name);
                    progress.put("copiedBytes", copied);
                    progress.put("totalBytes", reportedSize);
                    notifyListeners("modelImportProgress", progress);
                }
                output.getFD().sync();
            }
            if (reportedSize > 0 && copied != reportedSize) {
                throw new IllegalStateException("The selected model copy was incomplete.");
            }
            if (copied < 1024L * 1024L) {
                throw new IllegalStateException("The selected file is too small to be a GGUF model.");
            }
            try (RandomAccessFile header = new RandomAccessFile(partial, "r")) {
                byte[] magic = new byte[4];
                header.readFully(magic);
                if (magic[0] != 'G' || magic[1] != 'G' || magic[2] != 'U' || magic[3] != 'F') {
                    throw new IllegalStateException("This file does not have a valid GGUF header.");
                }
            }
            // The partial file lives beside the destination, so rename is an
            // atomic same-filesystem replacement on Android. Never delete the
            // old valid model before the replacement is ready to activate.
            if (!partial.renameTo(destination)) {
                throw new IllegalStateException("Could not atomically finalize the model file; the existing model was kept.");
            }
            JSObject response = new JSObject();
            response.put("cancelled", false);
            response.put("name", name);
            response.put("sizeBytes", copied);
            call.resolve(response);
        } catch (Exception error) {
            if (partial != null && partial.exists()) partial.delete();
            call.reject(error.getMessage() == null ? "Model import failed." : error.getMessage(), error);
        }
    }

    private String queryDisplayName(Uri uri) {
        try (Cursor cursor = getContext().getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) return cursor.getString(index);
            }
        } catch (Exception ignored) {}
        String fallback = uri.getLastPathSegment();
        return fallback == null ? "" : fallback;
    }

    private long querySize(Uri uri) {
        try (Cursor cursor = getContext().getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (index >= 0 && !cursor.isNull(index)) return cursor.getLong(index);
            }
        } catch (Exception ignored) {}
        return -1;
    }

    @PluginMethod
    public void downloadModel(PluginCall call) {
        final String name;
        final String source;
        final String expectedSha256;
        try {
            name = safeModelName(call.getString("name"));
            Matcher split = GGUF_SHARD.matcher(name);
            if (split.matches() && Integer.parseInt(split.group(3)) > 1) {
                throw new IllegalArgumentException("Download split GGUF models as a complete shard set. Use the multi-select import after obtaining all numbered parts.");
            }
            source = call.getString("url");
            expectedSha256 = call.getString("sha256", "").trim().toLowerCase(Locale.ROOT);
            if (source == null || source.length() > 4096) throw new IllegalArgumentException("A Hugging Face model URL is required.");
            URL parsed = new URL(source);
            if (!"https".equalsIgnoreCase(parsed.getProtocol()) || !"huggingface.co".equalsIgnoreCase(parsed.getHost())) {
                throw new IllegalArgumentException("Downloads must start from the official https://huggingface.co host.");
            }
            if (!expectedSha256.isEmpty() && !expectedSha256.matches("[a-f0-9]{64}")) {
                throw new IllegalArgumentException("Invalid SHA-256 checksum.");
            }
        } catch (Exception error) {
            call.reject(error.getMessage() == null ? "Invalid model download request." : error.getMessage());
            return;
        }

        inferenceExecutor.execute(() -> {
            File partial = null;
            HttpURLConnection connection = null;
            try {
                File destination = new File(modelDirectory(), name);
                if (destination.getAbsolutePath().equals(loadedModelPath)) {
                    call.reject("Unload this model before replacing it.");
                    return;
                }
                StatFs storage = new StatFs(modelDirectory().getAbsolutePath());
                final long availableAtStart = storage.getAvailableBytes();
                URL current = new URL(source);
                for (int redirects = 0; redirects <= 5; redirects++) {
                    connection = (HttpURLConnection) current.openConnection();
                    connection.setConnectTimeout(15000);
                    connection.setReadTimeout(30000);
                    connection.setInstanceFollowRedirects(false);
                    connection.setRequestProperty("User-Agent", "Ultran-Android/0.1");
                    int code = connection.getResponseCode();
                    if (code >= 300 && code < 400) {
                        String location = connection.getHeaderField("Location");
                        connection.disconnect();
                        connection = null;
                        if (location == null || redirects == 5) throw new IllegalStateException("Too many or invalid model download redirects.");
                        URL next = new URL(current, location);
                        String host = next.getHost().toLowerCase(Locale.ROOT);
                        if (!"https".equalsIgnoreCase(next.getProtocol()) ||
                                !(host.equals("huggingface.co") || host.endsWith(".huggingface.co") || host.equals("hf.co") || host.endsWith(".hf.co"))) {
                            throw new IllegalStateException("Model download redirected to an untrusted host.");
                        }
                        current = next;
                        continue;
                    }
                    if (code != HttpURLConnection.HTTP_OK) throw new IllegalStateException("Hugging Face download failed with HTTP " + code + ".");
                    break;
                }
                long total = connection.getContentLengthLong();
                final long maxBytes = MAX_MODEL_BYTES;
                if (total > maxBytes) throw new IllegalStateException("This model exceeds Ultran's 256 GB safety limit.");
                if (total > 0 && total > availableAtStart) throw new IllegalStateException("Not enough free device storage for this model.");
                partial = new File(modelDirectory(), name + ".partial");
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                long received = 0;
                try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(partial)) {
                    byte[] buffer = new byte[256 * 1024];
                    int read;
                    while ((read = input.read(buffer)) != -1) {
                        received += read;
                        if (received > maxBytes || received > availableAtStart) throw new IllegalStateException("Model download exceeded the available storage limit.");
                        digest.update(buffer, 0, read);
                        output.write(buffer, 0, read);
                        JSObject progress = new JSObject();
                        progress.put("name", name);
                        progress.put("copiedBytes", received);
                        progress.put("totalBytes", total);
                        notifyListeners("modelImportProgress", progress);
                    }
                    output.getFD().sync();
                }
                if (total > 0 && received != total) throw new IllegalStateException("Model download was incomplete.");
                if (received < 1024L * 1024L) throw new IllegalStateException("Downloaded file is too small to be a GGUF model.");
                if (!expectedSha256.isEmpty()) {
                    StringBuilder actual = new StringBuilder();
                    for (byte value : digest.digest()) actual.append(String.format(Locale.ROOT, "%02x", value & 0xff));
                    if (!expectedSha256.equals(actual.toString())) throw new IllegalStateException("SHA-256 checksum mismatch; downloaded file was rejected.");
                }
                try (RandomAccessFile header = new RandomAccessFile(partial, "r")) {
                    byte[] magic = new byte[4];
                    header.readFully(magic);
                    if (magic[0] != 'G' || magic[1] != 'G' || magic[2] != 'U' || magic[3] != 'F') {
                        throw new IllegalStateException("Downloaded file does not have a valid GGUF header.");
                    }
                }
                // Keep the previous valid model until the verified partial file
                // can replace it atomically in the same private directory.
                if (!partial.renameTo(destination)) throw new IllegalStateException("Could not atomically finalize downloaded model; the existing model was kept.");
                call.resolve(new JSObject().put("downloaded", true).put("name", name).put("sizeBytes", received));
            } catch (Exception error) {
                if (partial != null && partial.exists()) partial.delete();
                call.reject(error.getMessage() == null ? "Model download failed." : error.getMessage(), error);
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }

    private long modelSetSize(File model) {
        Matcher split = GGUF_SHARD.matcher(model.getName());
        if (!split.matches()) return model.length();
        int index = Integer.parseInt(split.group(2));
        int count = Integer.parseInt(split.group(3));
        if (index != 1) return model.length();
        long total = 0;
        String prefix = split.group(1);
        for (int part = 1; part <= count; part++) {
            File shard = new File(modelDirectory(), prefix + String.format(Locale.ROOT, "-%05d-of-%05d.gguf", part, count));
            if (!shard.isFile()) return model.length();
            total += shard.length();
        }
        return total;
    }

    @PluginMethod
    public void loadModel(PluginCall call) {
        final String name;
        try {
            name = safeModelName(call.getString("name"));
        } catch (Exception error) {
            call.reject(error.getMessage());
            return;
        }
        File model = new File(modelDirectory(), name);
        if (!model.isFile() || model.length() < 1024 * 1024) {
            call.reject("Import a valid GGUF model before loading it.");
            return;
        }

        if (model.getAbsolutePath().equals(loadedModelPath)) {
            call.resolve(new JSObject().put("loaded", true).put("name", name).put("contextTokens", loadedContextTokens > 0 ? loadedContextTokens : 2048).put("device", "CPU").put("memoryMapped", true).put("largeModelMode", loadedLargeModelMode));
            return;
        }

        inferenceExecutor.execute(() -> {
            try {
                if (loadedModelPath != null) {
                    NativeLlama.nativeUnloadModel();
                    loadedModelPath = null;
                }
                ActivityManager.MemoryInfo memory = new ActivityManager.MemoryInfo();
                ActivityManager manager = (ActivityManager) getContext().getSystemService(android.content.Context.ACTIVITY_SERVICE);
                if (manager != null) manager.getMemoryInfo(memory);
                // Model weights are file-backed. Do not compare the complete checkpoint
                // size with free RAM: mmap + lazy tensor loading lets the OS page weights
                // in on demand. The KV cache is still resident, so adapt context to headroom.
                final int contextTokens = memory.availMem > 0 && memory.availMem < 1024L * 1024L * 1024L
                        ? 512
                        : memory.availMem > 0 && memory.availMem < 2L * 1024L * 1024L * 1024L
                        ? 1024 : 2048;
                final boolean aggressiveLazyLoading = memory.availMem <= 0 || modelSetSize(model) > (long) (memory.availMem * 0.70);
                String error = NativeLlama.nativeLoadModel(model.getAbsolutePath(), contextTokens, aggressiveLazyLoading);
                if (error != null && !error.isEmpty()) {
                    loadedModelPath = null;
                    loadedContextTokens = 0;
                    loadedLargeModelMode = false;
                    call.reject(error);
                    return;
                }
                loadedModelPath = model.getAbsolutePath();
                loadedContextTokens = contextTokens;
                loadedLargeModelMode = aggressiveLazyLoading;
                JSObject response = new JSObject();
                response.put("loaded", true);
                response.put("name", name);
                response.put("contextTokens", contextTokens);
                response.put("device", "CPU");
                response.put("memoryMapped", true);
                response.put("largeModelMode", aggressiveLazyLoading);
                call.resolve(response);
            } catch (Throwable error) {
                loadedModelPath = null;
                loadedContextTokens = 0;
                loadedLargeModelMode = false;
                call.reject(error.getMessage() == null ? "Native model loading failed." : error.getMessage());
            }
        });
    }

    private void addInferenceMetrics(JSObject result) {
        try {
            JSONObject metrics = new JSONObject(NativeLlama.nativeGetLastMetrics());
            result.put("promptTokens", metrics.optInt("promptTokens"));
            result.put("generatedTokens", metrics.optInt("generatedTokens"));
            result.put("promptMs", metrics.optDouble("promptMs"));
            result.put("generationMs", metrics.optDouble("generationMs"));
            result.put("tokensPerSecond", metrics.optDouble("tokensPerSecond"));
            Debug.MemoryInfo processMemory = new Debug.MemoryInfo();
            Debug.getMemoryInfo(processMemory);
            result.put("processPssKb", processMemory.getTotalPss());
            result.put("processPrivateDirtyKb", processMemory.getTotalPrivateDirty());
        } catch (Exception ignored) {
            // Metrics are diagnostic only; they must never fail inference.
        }
    }

    @PluginMethod
    public void runBenchmark(PluginCall call) {
        if (loadedModelPath == null) {
            call.reject("Load a local GGUF model before running the benchmark.");
            return;
        }
        inferenceExecutor.execute(() -> {
            try {
                if (loadedModelPath == null) {
                    call.reject("The local model was unloaded before the benchmark started.");
                    return;
                }
                String output = NativeLlama.nativeGenerate(
                        new String[]{"user"},
                        new String[]{"Reply with one short word: READY."},
                        48
                );
                JSObject result = new JSObject();
                result.put("model", new File(loadedModelPath).getName());
                result.put("output", output == null ? "" : output);
                result.put("contextTokens", loadedContextTokens);
                result.put("largeModelMode", loadedLargeModelMode);
                addInferenceMetrics(result);
                call.resolve(result);
            } catch (Throwable error) {
                call.reject(error.getMessage() == null ? "On-device benchmark failed." : error.getMessage());
            }
        });
    }

    @PluginMethod
    public void generate(PluginCall call) {
        if (loadedModelPath == null) {
            call.reject("Load a local GGUF model first.");
            return;
        }
        JSArray messages = call.getArray("messages");
        if (messages == null || messages.length() == 0 || messages.length() > 40) {
            call.reject("A conversation with 1 to 40 messages is required.");
            return;
        }

        List<String> roles = new ArrayList<>();
        List<String> contents = new ArrayList<>();
        try {
            for (int i = 0; i < messages.length(); i++) {
                JSONObject message = messages.getJSONObject(i);
                String role = message.optString("role", "");
                String content = message.optString("content", "");
                if (!(role.equals("system") || role.equals("user") || role.equals("assistant"))) continue;
                roles.add(role);
                contents.add(content);
            }
        } catch (JSONException error) {
            call.reject("Conversation messages are invalid.");
            return;
        }
        if (roles.isEmpty()) {
            call.reject("Conversation contains no supported messages.");
            return;
        }

        final String[] roleArray = roles.toArray(new String[0]);
        final String[] contentArray = contents.toArray(new String[0]);
        final int maxTokens = Math.max(32, Math.min(512, call.getInt("maxTokens", 256)));
        inferenceExecutor.execute(() -> {
            try {
                if (loadedModelPath == null) {
                    call.reject("The local model was unloaded before inference started.");
                    return;
                }
                String text = NativeLlama.nativeGenerate(roleArray, contentArray, maxTokens);
                JSObject response = new JSObject();
                response.put("content", text == null ? "" : text);
                response.put("model", new File(loadedModelPath).getName());
                response.put("largeModelMode", loadedLargeModelMode);
                response.put("contextTokens", loadedContextTokens);
                addInferenceMetrics(response);
                call.resolve(response);
            } catch (Throwable error) {
                call.reject(error.getMessage() == null ? "Native inference failed." : error.getMessage());
            }
        });
    }

    @PluginMethod
    public void unloadModel(PluginCall call) {
        inferenceExecutor.execute(() -> {
            NativeLlama.nativeUnloadModel();
            loadedModelPath = null;
            loadedContextTokens = 0;
            loadedLargeModelMode = false;
            call.resolve(new JSObject().put("loaded", false));
        });
    }

    @PluginMethod
    public void deleteModel(PluginCall call) {
        final String name;
        try {
            name = safeModelName(call.getString("name"));
        } catch (Exception error) {
            call.reject(error.getMessage());
            return;
        }
        File model = new File(modelDirectory(), name);
        inferenceExecutor.execute(() -> {
            ArrayList<File> filesToDelete = new ArrayList<>();
            Matcher split = GGUF_SHARD.matcher(name);
            if (split.matches()) {
                int index = Integer.parseInt(split.group(2));
                int count = Integer.parseInt(split.group(3));
                if (index != 1) {
                    call.reject("Select the first shard entry to delete the complete model set.");
                    return;
                }
                String prefix = split.group(1);
                for (int part = 1; part <= count; part++) {
                    File shard = new File(modelDirectory(), prefix + String.format(Locale.ROOT, "-%05d-of-%05d.gguf", part, count));
                    if (!shard.isFile()) {
                        call.reject("The model shard set is incomplete; missing " + shard.getName() + ".");
                        return;
                    }
                    filesToDelete.add(shard);
                }
            } else {
                filesToDelete.add(model);
            }
            for (File file : filesToDelete) {
                if (file.getAbsolutePath().equals(loadedModelPath)) {
                    call.reject("Unload this model before deleting it.");
                    return;
                }
            }
            for (File file : filesToDelete) {
                if (file.exists() && !file.delete()) {
                    call.reject("Could not delete the complete model set. Failed at " + file.getName() + ".");
                    return;
                }
            }
            call.resolve(new JSObject().put("deleted", true).put("files", filesToDelete.size()));
        });
    }
}
