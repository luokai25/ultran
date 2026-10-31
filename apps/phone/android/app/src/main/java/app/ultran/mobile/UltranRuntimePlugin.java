package app.ultran.mobile;

import android.app.AlertDialog;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.StatFs;
import android.os.SystemClock;
import android.os.Build;
import android.provider.OpenableColumns;
import android.system.Os;
import android.system.OsConstants;
import android.system.ErrnoException;

import androidx.activity.result.ActivityResult;
import androidx.work.Data;
import androidx.work.OneTimeWorkRequest;
import androidx.work.OutOfQuotaPolicy;
import androidx.work.WorkInfo;
import androidx.work.WorkManager;

import java.util.UUID;

import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/** Installs a bootstrap built from the official Termux package source into Ultran's private prefix. */
@CapacitorPlugin(name = "UltranRuntime")
public final class UltranRuntimePlugin extends Plugin {
    private static final long MAX_ARCHIVE_BYTES = 512L * 1024L * 1024L;
    private static final String BOOTSTRAP_RELEASE_BASE = "https://github.com/luokai25/ultran/releases/download/ultran-termux-runtime-v1/";
    private static final long MAX_UNCOMPRESSED_BYTES = 2L * 1024L * 1024L * 1024L;
    private static final int MAX_ENTRIES = 100000;
    private static final int MAX_SYMLINK_MANIFEST_BYTES = 2 * 1024 * 1024;
    private final ExecutorService installer = Executors.newSingleThreadExecutor();
    private final ExecutorService commandExecutor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean commandApprovalPending = new AtomicBoolean(false);

    private File runtimeRoot() {
        return new File("/data/data/" + getContext().getPackageName() + "/files/ultran-runtime");
    }

    private File prefix() { return new File(runtimeRoot(), "usr"); }

    private File marker() { return new File(prefix(), ".ultran-bootstrap-installed"); }

    @PluginMethod
    public void getStatus(PluginCall call) {
        File bash = new File(prefix(), "bin/bash");
        File git = new File(prefix(), "bin/git");
        File python = new File(prefix(), "bin/python");
        File python3 = new File(prefix(), "bin/python3");
        File apt = new File(prefix(), "bin/apt");
        boolean installed = marker().isFile();
        boolean shellReady = installed && bash.isFile() && bash.canExecute();
        JSObject result = new JSObject();
        result.put("installed", installed);
        result.put("runtimeReady", shellReady);
        result.put("shell", shellReady ? bash.getAbsolutePath() : "/system/bin/sh");
        result.put("gitAvailable", installed && git.isFile() && git.canExecute());
        result.put("pythonAvailable", installed &&
            ((python.isFile() && python.canExecute()) || (python3.isFile() && python3.canExecute())));
        result.put("aptAvailable", installed && apt.isFile() && apt.canExecute());
        result.put("packageManagerEnabled", false);
        result.put("packageManagerNote", "APT repositories are disabled until Ultran publishes packages built for its private prefix.");
        result.put("prefix", prefix().getAbsolutePath());
        result.put("architecture", android.os.Build.SUPPORTED_ABIS.length == 0 ? "unknown" : android.os.Build.SUPPORTED_ABIS[0]);
        call.resolve(result);
    }

    @PluginMethod
    public void runCommand(PluginCall call) {
        String command = call.getString("command");
        if (command == null || command.trim().isEmpty()) {
            call.reject("Enter a command to run.");
            return;
        }
        if (command.length() > 4096 || command.indexOf('\0') >= 0) {
            call.reject("Commands must be at most 4,096 characters and cannot contain null bytes.");
            return;
        }
        if (!commandApprovalPending.compareAndSet(false, true)) {
            call.reject("Another local command is already awaiting approval.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                new AlertDialog.Builder(getActivity())
                    .setTitle("Approve local command")
                    .setMessage("Ultran wants to run this command on your device:\n\n" + command +
                        "\n\nIt runs without root in Ultran's app sandbox. It may change files or access the network. Review it before approving.")
                    .setPositiveButton("Run in background", (dialog, which) -> {
                        try { enqueueApprovedCommand(call, command); }
                        finally { commandApprovalPending.set(false); }
                    })
                    .setNegativeButton("Cancel", (dialog, which) -> {
                        commandApprovalPending.set(false);
                        call.resolve(new JSObject().put("approved", false));
                    })
                    .setOnCancelListener(dialog -> {
                        if (commandApprovalPending.compareAndSet(true, false)) {
                            call.resolve(new JSObject().put("approved", false));
                        }
                    })
                    .show();
            } catch (Exception error) {
                commandApprovalPending.set(false);
                call.reject("Could not request approval for the local command.", error);
            }
        });
    }

    private void enqueueApprovedCommand(PluginCall call, String command) {
        try {
            Data input = new Data.Builder().putString(UltranCommandWorker.KEY_COMMAND, command).build();
            OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(UltranCommandWorker.class)
                .setInputData(input)
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .addTag("ultran-local-runtime-job")
                .build();
            WorkManager.getInstance(getContext()).enqueue(request);
            JSObject result = new JSObject();
            result.put("approved", true);
            result.put("queued", true);
            result.put("jobId", request.getId().toString());
            result.put("status", "enqueued");
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Could not queue the approved background command.", error);
        }
    }

    @PluginMethod
    public void getCommandStatus(PluginCall call) {
        String rawId = call.getString("jobId");
        final UUID id;
        try {
            id = UUID.fromString(rawId == null ? "" : rawId);
        } catch (IllegalArgumentException invalid) {
            call.reject("A valid background job ID is required.");
            return;
        }
        WorkManager.getInstance(getContext()).getWorkInfoById(id).addListener(() -> {
            try {
                WorkInfo info = WorkManager.getInstance(getContext()).getWorkInfoById(id).get();
                if (info == null) {
                    call.resolve(new JSObject().put("found", false));
                    return;
                }
                JSObject result = new JSObject();
                result.put("found", true);
                result.put("jobId", id.toString());
                result.put("status", info.getState().name().toLowerCase(java.util.Locale.ROOT));
                Data output = info.getOutputData();
                String text = output.getString(UltranCommandWorker.KEY_OUTPUT);
                if (text != null) result.put("output", text);
                if (output.hasKeyWithValueOfType(UltranCommandWorker.KEY_EXIT_CODE, Integer.class)) {
                    result.put("exitCode", output.getInt(UltranCommandWorker.KEY_EXIT_CODE, -1));
                }
                result.put("timedOut", output.getBoolean(UltranCommandWorker.KEY_TIMED_OUT, false));
                if (output.hasKeyWithValueOfType("termuxRuntime", Boolean.class)) {
                    result.put("termuxRuntime", output.getBoolean("termuxRuntime", false));
                }
                String error = output.getString(UltranCommandWorker.KEY_ERROR);
                if (error != null) result.put("error", error);
                Data progress = info.getProgress();
                String phase = progress.getString("phase");
                if (phase != null) result.put("phase", phase);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Could not read background job status.", error);
            }
        }, commandExecutor);
    }

    @PluginMethod
    public void listCommandJobs(PluginCall call) {
        WorkManager.getInstance(getContext()).getWorkInfosByTag("ultran-local-runtime-job").addListener(() -> {
            try {
                List<WorkInfo> infos = WorkManager.getInstance(getContext())
                    .getWorkInfosByTag("ultran-local-runtime-job").get();
                JSArray jobs = new JSArray();
                int count = 0;
                for (WorkInfo info : infos) {
                    if (count++ >= 20) break;
                    JSObject item = new JSObject();
                    item.put("jobId", info.getId().toString());
                    item.put("status", info.getState().name().toLowerCase(java.util.Locale.ROOT));
                    Data output = info.getOutputData();
                    String outputText = output.getString(UltranCommandWorker.KEY_OUTPUT);
                    if (outputText != null) item.put("output", outputText);
                    String error = output.getString(UltranCommandWorker.KEY_ERROR);
                    if (error != null) item.put("error", error);
                    if (output.hasKeyWithValueOfType(UltranCommandWorker.KEY_EXIT_CODE, Integer.class)) {
                        item.put("exitCode", output.getInt(UltranCommandWorker.KEY_EXIT_CODE, -1));
                    }
                    jobs.put(item);
                }
                call.resolve(new JSObject().put("jobs", jobs));
            } catch (Exception error) {
                call.reject("Could not list background runtime jobs.", error);
            }
        }, commandExecutor);
    }

    @PluginMethod
    public void cancelCommand(PluginCall call) {
        String rawId = call.getString("jobId");
        try {
            UUID id = UUID.fromString(rawId == null ? "" : rawId);
            WorkManager.getInstance(getContext()).cancelWorkById(id);
            call.resolve(new JSObject().put("jobId", id.toString()).put("status", "cancellation_requested"));
        } catch (IllegalArgumentException invalid) {
            call.reject("A valid background job ID is required.");
        }
    }

    private HttpURLConnection openTrustedGithubConnection(String address) throws Exception {
        URL current = new URL(address);
        for (int redirects = 0; redirects <= 5; redirects++) {
            if (!"https".equalsIgnoreCase(current.getProtocol())) {
                throw new IllegalStateException("Runtime downloads must use HTTPS.");
            }
            HttpURLConnection connection = (HttpURLConnection) current.openConnection();
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(30000);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("User-Agent", "Ultran-Android/0.1");
            connection.setRequestProperty("Accept", "application/octet-stream");
            int code = connection.getResponseCode();
            if (code >= 300 && code < 400) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null || redirects == 5) {
                    throw new IllegalStateException("Runtime download returned too many or invalid redirects.");
                }
                URL next = new URL(current, location);
                String host = next.getHost().toLowerCase(java.util.Locale.ROOT);
                boolean trusted = host.equals("github.com") || host.endsWith(".github.com")
                    || host.equals("githubusercontent.com") || host.endsWith(".githubusercontent.com");
                if (!"https".equalsIgnoreCase(next.getProtocol()) || !trusted) {
                    throw new IllegalStateException("Runtime download redirected to an untrusted host.");
                }
                current = next;
                continue;
            }
            if (code != HttpURLConnection.HTTP_OK) {
                connection.disconnect();
                throw new IllegalStateException("GitHub runtime download failed with HTTP " + code + ".");
            }
            return connection;
        }
        throw new IllegalStateException("Could not open the runtime download.");
    }

    private byte[] readGithubAsset(String address, long maxBytes) throws Exception {
        HttpURLConnection connection = openTrustedGithubConnection(address);
        try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int read;
            long total = 0;
            while ((read = input.read(buffer)) != -1) {
                total += read;
                if (total > maxBytes) throw new IllegalStateException("Runtime checksum manifest is unexpectedly large.");
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        } finally {
            connection.disconnect();
        }
    }

    private String downloadGithubAsset(String address, File destination, PluginCall call) throws Exception {
        HttpURLConnection connection = openTrustedGithubConnection(address);
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try {
            long total = connection.getContentLengthLong();
            if (total > MAX_ARCHIVE_BYTES) throw new IllegalStateException("Termux runtime archive exceeds the 512 MB download limit.");
            long available = new StatFs(getContext().getCacheDir().getAbsolutePath()).getAvailableBytes();
            if (total > 0 && total > available) throw new IllegalStateException("Not enough free storage to download the Termux runtime.");
            long received = 0;
            try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(destination)) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    received += read;
                    if (received > MAX_ARCHIVE_BYTES || received > available) {
                        throw new IllegalStateException("Runtime download exceeded the available storage limit.");
                    }
                    digest.update(buffer, 0, read);
                    output.write(buffer, 0, read);
                    JSObject progress = new JSObject();
                    progress.put("downloadedBytes", received);
                    progress.put("totalBytes", total);
                    notifyListeners("runtimeDownloadProgress", progress);
                }
                output.getFD().sync();
            }
            if (total > 0 && received != total) throw new IllegalStateException("Termux runtime download was incomplete.");
            StringBuilder hex = new StringBuilder();
            for (byte value : digest.digest()) hex.append(String.format(java.util.Locale.ROOT, "%02x", value & 0xff));
            return hex.toString();
        } finally {
            connection.disconnect();
        }
    }

    private String checksumForAsset(byte[] manifest, String assetName) {
        String text = new String(manifest, StandardCharsets.UTF_8);
        for (String line : text.split("\\r?\\n")) {
            String[] fields = line.trim().split("\\s+");
            if (fields.length >= 2 && fields[1].replaceFirst("^\\*", "").equals(assetName)
                    && fields[0].matches("(?i)[a-f0-9]{64}")) {
                return fields[0].toLowerCase(java.util.Locale.ROOT);
            }
        }
        throw new IllegalStateException("GitHub's SHA256SUMS does not include " + assetName + ".");
    }

    @PluginMethod
    public void downloadBootstrap(PluginCall call) {
        installer.execute(() -> {
            File partial = null;
            try {
                String abi = android.os.Build.SUPPORTED_ABIS.length == 0 ? "" : android.os.Build.SUPPORTED_ABIS[0];
                final String assetName;
                if (abi.equals("arm64-v8a") || abi.equals("aarch64")) assetName = "bootstrap-aarch64.zip";
                else if (abi.equals("x86_64")) assetName = "bootstrap-x86_64.zip";
                else throw new IllegalStateException("No published Termux runtime matches this device architecture: " + abi);
                byte[] manifest = readGithubAsset(BOOTSTRAP_RELEASE_BASE + "SHA256SUMS", 64 * 1024);
                String expected = checksumForAsset(manifest, assetName);
                File archive = new File(getContext().getCacheDir(), assetName);
                partial = new File(getContext().getCacheDir(), assetName + ".partial");
                if (partial.exists() && !partial.delete()) throw new IllegalStateException("Could not clear an incomplete runtime download.");
                String actual = downloadGithubAsset(BOOTSTRAP_RELEASE_BASE + assetName, partial, call);
                if (!expected.equals(actual)) throw new IllegalStateException("Termux runtime SHA-256 verification failed; the archive was rejected.");
                if (!partial.renameTo(archive)) throw new IllegalStateException("Could not finalize the verified runtime archive.");
                partial = null;
                installBootstrap(call, Uri.fromFile(archive));
                // The archive is only a staging download; free the space after
                // the installer has consumed it, whether install succeeded or not.
                if (archive.exists()) archive.delete();
            } catch (Exception error) {
                if (partial != null && partial.exists()) partial.delete();
                call.reject(error.getMessage() == null ? "Could not download the official Termux runtime." : error.getMessage(), error);
            }
        });
    }

    @PluginMethod
    public void pickBootstrap(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/zip");
        startActivityForResult(call, intent, "handleBootstrapPicked");
    }

    @ActivityCallback
    private void handleBootstrapPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result == null || result.getResultCode() != android.app.Activity.RESULT_OK ||
                result.getData() == null || result.getData().getData() == null) {
            call.resolve(new JSObject().put("cancelled", true));
            return;
        }
        Uri uri = result.getData().getData();
        installer.execute(() -> installBootstrap(call, uri));
    }

    private void installBootstrap(PluginCall call, Uri uri) {
        File root = runtimeRoot();
        File staging = new File(root, "usr-staging");
        File destination = prefix();
        File backup = new File(root, "usr-backup");
        boolean previousPrefixBackedUp = false;
        boolean newPrefixActivated = false;
        try {
            long archiveSize = querySize(uri);
            if (archiveSize > MAX_ARCHIVE_BYTES) {
                throw new IllegalArgumentException("Bootstrap archive exceeds the 512 MB compressed-size limit.");
            }
            if (!root.exists() && !root.mkdirs() && !root.isDirectory()) {
                throw new IllegalStateException("Could not create Ultran's private runtime directory.");
            }
            long availableAtStart = new StatFs(root.getAbsolutePath()).getAvailableBytes();
            if (archiveSize > 0 && archiveSize > availableAtStart) {
                throw new IllegalStateException("Not enough free device storage for this bootstrap archive.");
            }
            deleteRecursively(staging);
            if (!staging.mkdirs() && !staging.isDirectory()) {
                throw new IllegalStateException("Could not create the runtime staging directory.");
            }

            List<String[]> symlinks = new ArrayList<>();
            long totalBytes = 0;
            int entryCount = 0;
            byte[] buffer = new byte[32 * 1024];
            InputStream raw = getContext().getContentResolver().openInputStream(uri);
            if (raw == null) throw new IllegalStateException("Could not open the selected bootstrap archive.");
            try (InputStream bounded = new BoundedInputStream(raw, MAX_ARCHIVE_BYTES);
                 ZipInputStream zip = new ZipInputStream(bounded)) {
                ZipEntry entry;
                while ((entry = zip.getNextEntry()) != null) {
                    if (++entryCount > MAX_ENTRIES) throw new IllegalArgumentException("Bootstrap contains too many entries.");
                    String name = entry.getName();
                    if ("SYMLINKS.txt".equals(name)) {
                        byte[] manifest = readBounded(zip, MAX_SYMLINK_MANIFEST_BYTES);
                        try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                                new java.io.ByteArrayInputStream(manifest), StandardCharsets.UTF_8))) {
                            String line;
                            while ((line = reader.readLine()) != null) {
                                int separator = line.indexOf('←');
                                if (separator <= 0 || separator != line.lastIndexOf('←') || separator == line.length() - 1) {
                                    throw new IllegalArgumentException("Malformed Termux symlink manifest entry.");
                                }
                                symlinks.add(new String[]{line.substring(0, separator), line.substring(separator + 1)});
                            }
                        }
                        continue;
                    }

                    String safeName = validateRelativePath(name);
                    if (".ultran-bootstrap-installed".equals(safeName)) throw new IllegalArgumentException("Bootstrap attempts to overwrite Ultran's runtime marker.");
                    File target = new File(staging, safeName);
                    String stagingPath = staging.getCanonicalPath() + File.separator;
                    String targetPath = target.getCanonicalPath();
                    if (!targetPath.startsWith(stagingPath)) throw new IllegalArgumentException("Archive entry escapes the staging directory.");
                    if (entry.isDirectory() || name.endsWith("/")) {
                        if (!target.mkdirs() && !target.isDirectory()) throw new IllegalStateException("Could not create runtime directory.");
                        continue;
                    }
                    File parent = target.getParentFile();
                    if (parent != null && !parent.mkdirs() && !parent.isDirectory()) throw new IllegalStateException("Could not create runtime directory.");
                    try (FileOutputStream output = new FileOutputStream(target)) {
                        int read;
                        while ((read = zip.read(buffer)) != -1) {
                            totalBytes += read;
                            if (totalBytes > MAX_UNCOMPRESSED_BYTES) throw new IllegalArgumentException("Bootstrap expands beyond the 2 GB safety limit.");
                            if (totalBytes > availableAtStart) throw new IllegalStateException("Not enough free device storage to extract the bootstrap safely.");
                            output.write(buffer, 0, read);
                        }
                        output.getFD().sync();
                    }
                    if (isExecutablePath(safeName)) Os.chmod(target.getAbsolutePath(), 0700);
                }
            }

            if (symlinks.isEmpty()) throw new IllegalArgumentException("This is not a supported Termux bootstrap: SYMLINKS.txt is missing or empty.");
            verifyBootstrapArchitecture(staging);
            String finalPrefix = destination.getCanonicalPath();
            for (String[] link : symlinks) {
                String linkTarget = link[0];
                String linkRelativePath = validateRelativePath(link[1]);
                if (".ultran-bootstrap-installed".equals(linkRelativePath)) throw new IllegalArgumentException("Bootstrap attempts to replace Ultran's runtime marker with a symlink.");
                if (isAptSourcePath(linkRelativePath)) continue;
                if (!isAllowedSymlinkTarget(linkTarget, linkRelativePath, finalPrefix)) {
                    throw new IllegalArgumentException("Bootstrap contains an unexpected symlink target.");
                }
                File linkFile = new File(staging, linkRelativePath);
                String stagingPath = staging.getCanonicalPath() + File.separator;
                if (!linkFile.getCanonicalPath().startsWith(stagingPath)) throw new IllegalArgumentException("Symlink path escapes the runtime staging directory.");
                File parent = linkFile.getParentFile();
                if (parent != null && !parent.mkdirs() && !parent.isDirectory()) throw new IllegalStateException("Could not create symlink parent directory.");
                if (linkFile.exists() || isSymbolicLink(linkFile)) throw new IllegalArgumentException("Symlink would overwrite an existing bootstrap entry.");
                Os.symlink(linkTarget, linkFile.getAbsolutePath());
            }

            deleteRecursively(backup);
            boolean hadPreviousPrefix = destination.exists() || isSymbolicLink(destination);
            if (hadPreviousPrefix) {
                if (!destination.renameTo(backup)) throw new IllegalStateException("Could not safely back up the existing runtime.");
                previousPrefixBackedUp = true;
            }
            if (!staging.renameTo(destination)) {
                throw new IllegalStateException("Could not activate the extracted runtime.");
            }
            newPrefixActivated = true;

            // The official Termux installer runs this second stage after extraction.
            // It configures package post-install scripts; without it, a bootstrap can
            // look present while essential packages remain only partially configured.
            runBootstrapSecondStage(destination);
            disableIncompatiblePackageSources(destination);
            try (FileOutputStream markerOutput = new FileOutputStream(new File(destination, ".ultran-bootstrap-installed"))) {
                markerOutput.write(("termux-packages bootstrap; installed=" + System.currentTimeMillis() + "\n").getBytes(StandardCharsets.UTF_8));
                markerOutput.getFD().sync();
            }
            try {
                deleteRecursively(backup);
                previousPrefixBackedUp = false;
            } catch (Exception ignored) { }
            call.resolve(new JSObject().put("installed", true).put("prefix", destination.getAbsolutePath()).put("entries", entryCount).put("uncompressedBytes", totalBytes));
        } catch (Exception error) {
            if (newPrefixActivated && (destination.exists() || isSymbolicLink(destination))) {
                try { deleteRecursively(destination); } catch (Exception ignored) { }
            }
            if (previousPrefixBackedUp && (backup.exists() || isSymbolicLink(backup))) {
                try { backup.renameTo(destination); } catch (Exception ignored) { }
            }
            try { deleteRecursively(staging); } catch (Exception ignored) { }
            call.reject(error.getMessage() == null ? "Could not install the Termux bootstrap." : error.getMessage(), error);
        }
    }

    private void runBootstrapSecondStage(File prefixDirectory) throws Exception {
        File script = new File(prefixDirectory,
            "etc/termux/termux-bootstrap/second-stage/termux-bootstrap-second-stage.sh");
        File bash = new File(prefixDirectory, "bin/bash");
        if (!bash.isFile() || !bash.canExecute()) {
            throw new IllegalStateException("Termux bootstrap is missing its executable Bash shell.");
        }
        if (!script.isFile()) {
            throw new IllegalStateException("Termux bootstrap is missing its official second-stage setup script.");
        }

        File runtime = prefixDirectory.getParentFile();
        File home = new File(runtime, "home");
        File temp = new File(runtime, "tmp");
        File appData = new File("/data/data/" + getContext().getPackageName());
        File project = new File(appData, "termux");
        File apps = new File(project, "app");
        File appsByIdentifier = new File(apps, "i");
        File appsByUid = new File(apps, "u");
        File cache = new File(appData, "cache");
        File[] requiredDirectories = {home, temp, new File(project, "core"), appsByIdentifier, appsByUid, cache, new File(home, ".termux")};
        for (File directory : requiredDirectories) {
            if (!directory.exists() && !directory.mkdirs() && !directory.isDirectory()) {
                throw new IllegalStateException("Could not prepare a private directory for Termux bootstrap setup: " + directory.getName());
            }
        }

        ProcessBuilder builder = new ProcessBuilder(bash.getAbsolutePath(), script.getAbsolutePath());
        builder.directory(home);
        builder.redirectInput(new File("/dev/null"));
        builder.redirectErrorStream(true);
        Map<String, String> env = builder.environment();
        env.put("HOME", home.getAbsolutePath());
        env.put("TERMUX__HOME", home.getAbsolutePath());
        env.put("TERMUX_ANDROID_HOME", home.getAbsolutePath());
        env.put("PREFIX", prefixDirectory.getAbsolutePath());
        env.put("TERMUX_PREFIX", prefixDirectory.getAbsolutePath());
        env.put("TERMUX__PREFIX", prefixDirectory.getAbsolutePath());
        env.put("TERMUX__PREFIX_CLASSICAL", prefixDirectory.getAbsolutePath());
        env.put("TERMUX__ROOTFS", runtime.getAbsolutePath());
        env.put("TERMUX__ROOTFS_SUBDIR", "files/ultran-runtime");
        env.put("TERMUX__UID", Integer.toString(android.os.Process.myUid()));
        env.put("TERMUX__USER_ID", Integer.toString(android.os.Process.myUid()));
        env.put("TERMUX_APP__PACKAGE_NAME", getContext().getPackageName());
        env.put("TERMUX_APP__DATA_DIR", appData.getAbsolutePath());
        env.put("TERMUX__PROJECT_DIR", project.getAbsolutePath());
        env.put("TERMUX__CORE_DIR", new File(project, "core").getAbsolutePath());
        env.put("TERMUX__APPS_DIR", apps.getAbsolutePath());
        env.put("TERMUX__APPS_DIR_BY_IDENTIFIER", appsByIdentifier.getAbsolutePath());
        env.put("TERMUX__APPS_DIR_BY_UID", appsByUid.getAbsolutePath());
        env.put("TERMUX__CACHE_DIR", cache.getAbsolutePath());
        env.put("TERMUX__LEGACY_PROJECT_USER_CONFIG_DIR", new File(home, ".termux").getAbsolutePath());
        env.put("TERMUX__INTERNAL_NAME", "termux");
        env.put("TERMUX__LNAME", "termux");
        env.put("TERMUX__UNAME", "TERMUX");
        env.put("TERMUX__NAME", "Termux");
        env.put("TERMUX_APP__NAME", "Termux");
        env.put("TERMUX_APP__LNAME", "termux");
        env.put("TERMUX_APP__APP_IDENTIFIER", "termux");
        env.put("TERMUX_APP__APP_DIR", new File(appsByIdentifier, "termux").getAbsolutePath());
        env.put("TMPDIR", temp.getAbsolutePath());
        env.put("PATH", new File(prefixDirectory, "bin").getAbsolutePath() + ":/system/bin:/system/xbin");
        env.put("LD_LIBRARY_PATH", new File(prefixDirectory, "lib").getAbsolutePath());
        env.put("SHELL", bash.getAbsolutePath());
        env.put("TERM", "dumb");
        env.put("LANG", "C.UTF-8");
        env.put("DEBIAN_FRONTEND", "noninteractive");

        Process process = builder.start();
        ByteArrayOutputStream captured = new ByteArrayOutputStream();
        Thread reader = new Thread(() -> {
            byte[] buffer = new byte[4096];
            try (InputStream input = process.getInputStream()) {
                int count;
                while ((count = input.read(buffer)) != -1) {
                    synchronized (captured) {
                        int remaining = 64 * 1024 - captured.size();
                        if (remaining > 0) captured.write(buffer, 0, Math.min(remaining, count));
                    }
                }
            } catch (Exception ignored) { }
        }, "ultran-termux-bootstrap-output");
        reader.start();
        long deadline = SystemClock.elapsedRealtime() + TimeUnit.MINUTES.toMillis(3);
        try {
            while (true) {
                try {
                    process.exitValue();
                    break;
                } catch (IllegalThreadStateException running) {
                    if (SystemClock.elapsedRealtime() >= deadline) {
                        process.destroy();
                        if (Build.VERSION.SDK_INT >= 26) process.destroyForcibly();
                        throw new IllegalStateException("Termux second-stage package setup exceeded the three-minute safety limit.");
                    }
                    Thread.sleep(150);
                }
            }
            reader.join(2000);
            int exitCode = process.exitValue();
            if (exitCode != 0) {
                String details;
                synchronized (captured) { details = captured.toString("UTF-8"); }
                if (details.length() > 6000) details = details.substring(details.length() - 6000);
                throw new IllegalStateException("Termux second-stage package setup failed with exit code " + exitCode +
                    (details.isEmpty() ? "." : ":\n" + details));
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            process.destroy();
            if (Build.VERSION.SDK_INT >= 26) process.destroyForcibly();
            throw new IllegalStateException("Termux second-stage setup was interrupted.", interrupted);
        } finally {
            if (reader.isAlive()) reader.interrupt();
            try { process.getInputStream().close(); } catch (Exception ignored) { }
        }
    }

    private long querySize(Uri uri) {
        try (Cursor cursor = getContext().getContentResolver().query(uri, new String[]{OpenableColumns.SIZE}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) return cursor.getLong(0);
        } catch (Exception ignored) { }
        return -1;
    }

    private byte[] readBounded(InputStream input, int limit) throws Exception {
        java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        int read;
        while ((read = input.read(buffer)) != -1) {
            if (output.size() + read > limit) throw new IllegalArgumentException("Termux symlink manifest is too large.");
            output.write(buffer, 0, read);
        }
        return output.toByteArray();
    }

    private String validateRelativePath(String path) {
        if (path == null || path.isEmpty() || path.startsWith("/") || path.startsWith("\\") || path.contains("\\") || path.indexOf('\0') >= 0 || path.matches("^[A-Za-z]:.*")) {
            throw new IllegalArgumentException("Bootstrap contains an unsafe path.");
        }
        String normalized = path.endsWith("/") ? path.substring(0, path.length() - 1) : path;
        if (normalized.isEmpty()) throw new IllegalArgumentException("Bootstrap contains an empty path.");
        for (String segment : normalized.split("/", -1)) {
            if (segment.isEmpty() || ".".equals(segment) || "..".equals(segment)) throw new IllegalArgumentException("Bootstrap contains a path traversal entry.");
        }
        return normalized;
    }

    private void verifyBootstrapArchitecture(File staging) throws Exception {
        File bash = new File(staging, "bin/bash");
        byte[] header = new byte[20];
        try (InputStream input = new java.io.FileInputStream(bash)) {
            int offset = 0;
            while (offset < header.length) {
                int read = input.read(header, offset, header.length - offset);
                if (read < 0) throw new IllegalArgumentException("Bootstrap is missing a valid bin/bash ELF executable.");
                offset += read;
            }
        }
        if ((header[0] & 0xff) != 0x7f || header[1] != 'E' || header[2] != 'L' || header[3] != 'F' || header[5] != 1) {
            throw new IllegalArgumentException("Bootstrap bin/bash is not a supported little-endian ELF executable.");
        }
        int machine = (header[18] & 0xff) | ((header[19] & 0xff) << 8);
        boolean supported = false;
        for (String abi : android.os.Build.SUPPORTED_ABIS) {
            if (("arm64-v8a".equals(abi) && machine == 183) || ("x86_64".equals(abi) && machine == 62)) {
                supported = true;
                break;
            }
        }
        if (!supported) {
            String actual = machine == 183 ? "arm64-v8a" : machine == 62 ? "x86_64" : "ELF machine " + machine;
            throw new IllegalArgumentException("Bootstrap architecture (" + actual + ") does not match this device (" +
                (android.os.Build.SUPPORTED_ABIS.length == 0 ? "unknown" : android.os.Build.SUPPORTED_ABIS[0]) + "). Select the matching bootstrap ZIP.");
        }
    }

    private boolean isAptSourcePath(String path) {
        return "etc/apt/sources.list".equals(path) || "etc/apt/sources.list.d".equals(path) ||
            path.startsWith("etc/apt/sources.list.d/");
    }

    private void disableIncompatiblePackageSources(File staging) throws Exception {
        File aptDirectory = new File(staging, "etc/apt");
        if (!aptDirectory.exists() && !aptDirectory.mkdirs()) throw new IllegalStateException("Could not prepare isolated package configuration.");
        File sourceList = new File(aptDirectory, "sources.list");
        if (isSymbolicLink(sourceList)) sourceList.delete();
        try (FileOutputStream output = new FileOutputStream(sourceList)) {
            output.write("# Disabled by Ultran: upstream Termux packages target a different private prefix.\n# Configure an Ultran-built package repository before installing additional packages.\n".getBytes(StandardCharsets.UTF_8));
            output.getFD().sync();
        }
        File sourceParts = new File(aptDirectory, "sources.list.d");
        if (isSymbolicLink(sourceParts)) sourceParts.delete();
        if (!sourceParts.exists() && !sourceParts.mkdirs()) throw new IllegalStateException("Could not isolate package source configuration.");
        File[] sourceFiles = sourceParts.listFiles();
        if (sourceFiles != null) {
            for (File sourceFile : sourceFiles) {
                if (sourceFile.isDirectory() && !isSymbolicLink(sourceFile)) deleteRecursively(sourceFile);
                else if (!sourceFile.delete()) throw new IllegalStateException("Could not disable an incompatible package source.");
            }
        }
    }

    private boolean isAllowedSymlinkTarget(String target, String linkRelativePath, String finalPrefix) {
        if (target == null || target.isEmpty() || target.indexOf('\0') >= 0 || target.contains("\\")) return false;
        try {
            File link = new File(finalPrefix, linkRelativePath);
            File targetFile = new File(target);
            // Termux bootstrap manifests mostly use relative targets such as ../lib/libfoo.so.
            // Resolve them from the link's parent, not from the process working directory.
            String canonical = (targetFile.isAbsolute()
                ? targetFile : new File(link.getParentFile(), target)).getCanonicalPath();
            return canonical.equals(finalPrefix) || canonical.startsWith(finalPrefix + File.separator) ||
                canonical.equals("/system") || canonical.startsWith("/system/") ||
                canonical.equals("/apex") || canonical.startsWith("/apex/") ||
                canonical.equals("/vendor") || canonical.startsWith("/vendor/");
        } catch (Exception ignored) { return false; }
    }

    private boolean isExecutablePath(String path) {
        return path.startsWith("bin/") || path.startsWith("libexec/") ||
            path.startsWith("lib/apt/apt-helper") || path.startsWith("lib/apt/methods/");
    }

    private boolean isSymbolicLink(File file) {
        try {
            return (Os.lstat(file.getAbsolutePath()).st_mode & OsConstants.S_IFMT) == OsConstants.S_IFLNK;
        } catch (ErrnoException ignored) {
            return false;
        }
    }

    private static final class BoundedInputStream extends FilterInputStream {
        private final long limit;
        private long count;
        BoundedInputStream(InputStream input, long limit) { super(input); this.limit = limit; }
        @Override public int read() throws IOException {
            int value = super.read();
            if (value != -1 && ++count > limit) throw new IOException("Bootstrap archive exceeds the 512 MB compressed-size limit.");
            return value;
        }
        @Override public int read(byte[] buffer, int offset, int length) throws IOException {
            int read = super.read(buffer, offset, length);
            if (read > 0) {
                count += read;
                if (count > limit) throw new IOException("Bootstrap archive exceeds the 512 MB compressed-size limit.");
            }
            return read;
        }
    }

    private void deleteRecursively(File file) throws Exception {
        boolean symlink = isSymbolicLink(file);
        if (!file.exists() && !symlink) return;
        if (symlink || file.isFile()) {
            if (!file.delete()) throw new IllegalStateException("Could not remove previous runtime file.");
            return;
        }
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteRecursively(child);
        if (!file.delete()) throw new IllegalStateException("Could not remove previous runtime directory.");
    }
}
