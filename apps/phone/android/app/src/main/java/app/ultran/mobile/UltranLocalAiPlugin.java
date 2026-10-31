package app.ultran.mobile;

import android.app.ActivityManager;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.StatFs;
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
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "UltranLocalAI")
public class UltranLocalAiPlugin extends Plugin {
    // One queue serializes model imports, load/unload, inference and deletion so
    // a file can never be replaced or removed while native code is reading it.
    private final ExecutorService inferenceExecutor = Executors.newSingleThreadExecutor();
    private volatile String loadedModelPath;

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
    public void listModels(PluginCall call) {
        JSArray models = new JSArray();
        File[] files = modelDirectory().listFiles((dir, name) -> name.toLowerCase().endsWith(".gguf"));
        if (files != null) {
            for (File file : files) {
                JSObject item = new JSObject();
                item.put("name", file.getName());
                item.put("sizeBytes", file.length());
                item.put("loaded", file.getAbsolutePath().equals(loadedModelPath));
                try { models.put(item); } catch (JSONException ignored) {}
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
        startActivityForResult(call, intent, "handleModelPicked");
    }

    @ActivityCallback
    private void handleModelPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result == null || result.getResultCode() != android.app.Activity.RESULT_OK ||
                result.getData() == null || result.getData().getData() == null) {
            call.resolve(new JSObject().put("cancelled", true));
            return;
        }
        Uri uri = result.getData().getData();
        String displayName = queryDisplayName(uri);
        inferenceExecutor.execute(() -> importSelectedModel(call, uri, displayName));
    }

    private void importSelectedModel(PluginCall call, Uri uri, String displayName) {
        File partial = null;
        try {
            String name = safeModelName(displayName);
            File destination = new File(modelDirectory(), name);
            if (destination.getAbsolutePath().equals(loadedModelPath)) {
                call.reject("Unload this model before replacing it.");
                return;
            }

            long reportedSize = querySize(uri);
            if (reportedSize > 8L * 1024L * 1024L * 1024L) {
                call.reject("This model exceeds Ultran's 8 GB import limit.");
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
                    if (copied > 8L * 1024L * 1024L * 1024L || copied > availableAtStart) {
                        throw new IllegalStateException("The model exceeds the available device storage limit.");
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
            if (destination.exists() && !destination.delete()) {
                throw new IllegalStateException("Could not replace the existing model file.");
            }
            if (!partial.renameTo(destination)) {
                throw new IllegalStateException("Could not finalize the model file.");
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
            call.resolve(new JSObject().put("loaded", true).put("name", name).put("contextTokens", 2048).put("device", "CPU"));
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
                if (memory.availMem > 0 && model.length() > (long) (memory.availMem * 0.70)) {
                    call.reject("This model is too large for currently available memory. Close other apps or choose a smaller quantized model.");
                    return;
                }
                String error = NativeLlama.nativeLoadModel(model.getAbsolutePath());
                if (error != null && !error.isEmpty()) {
                    loadedModelPath = null;
                    call.reject(error);
                    return;
                }
                loadedModelPath = model.getAbsolutePath();
                JSObject response = new JSObject();
                response.put("loaded", true);
                response.put("name", name);
                response.put("contextTokens", 2048);
                response.put("device", "CPU");
                call.resolve(response);
            } catch (Throwable error) {
                loadedModelPath = null;
                call.reject(error.getMessage() == null ? "Native model loading failed." : error.getMessage());
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
            if (model.getAbsolutePath().equals(loadedModelPath)) {
                call.reject("Unload this model before deleting it.");
                return;
            }
            if (model.exists() && !model.delete()) {
                call.reject("Could not delete the model file.");
                return;
            }
            call.resolve(new JSObject().put("deleted", true));
        });
    }
}
