package app.ultran.mobile;

import android.app.AlertDialog;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.StatFs;
import android.provider.OpenableColumns;
import android.system.Os;
import android.system.OsConstants;
import android.system.ErrnoException;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
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
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/** Installs a bootstrap built from the official Termux package source into Ultran's private prefix. */
@CapacitorPlugin(name = "UltranRuntime")
public final class UltranRuntimePlugin extends Plugin {
    private static final long MAX_ARCHIVE_BYTES = 512L * 1024L * 1024L;
    private static final long MAX_UNCOMPRESSED_BYTES = 2L * 1024L * 1024L * 1024L;
    private static final int MAX_ENTRIES = 100000;
    private static final int MAX_SYMLINK_MANIFEST_BYTES = 2 * 1024 * 1024;
    private final ExecutorService installer = Executors.newSingleThreadExecutor();
    private final ExecutorService commandExecutor = Executors.newSingleThreadExecutor();
    private static final int MAX_COMMAND_OUTPUT_BYTES = 48 * 1024;
    private static final long COMMAND_TIMEOUT_SECONDS = 30;

    private File runtimeRoot() {
        return new File("/data/data/" + getContext().getPackageName() + "/files/ultran-runtime");
    }

    private File prefix() { return new File(runtimeRoot(), "usr"); }

    private File marker() { return new File(prefix(), ".ultran-bootstrap-installed"); }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("installed", marker().isFile());
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
        getActivity().runOnUiThread(() -> new AlertDialog.Builder(getActivity())
            .setTitle("Approve local command")
            .setMessage("Ultran wants to run this command on your device:\n\n" + command +
                "\n\nIt runs without root in Ultran's app sandbox. It may change files or access the network. Review it before approving.")
            .setPositiveButton("Run command", (dialog, which) -> commandExecutor.execute(() -> executeApprovedCommand(call, command)))
            .setNegativeButton("Cancel", (dialog, which) -> call.resolve(new JSObject().put("approved", false)))
            .setOnCancelListener(dialog -> call.resolve(new JSObject().put("approved", false)))
            .show());
    }

    private void executeApprovedCommand(PluginCall call, String command) {
        Process process = null;
        Thread reader = null;
        ByteArrayOutputStream captured = new ByteArrayOutputStream();
        AtomicBoolean truncated = new AtomicBoolean(false);
        try {
            File runtime = runtimeRoot();
            File prefix = prefix();
            File home = new File(runtime, "home");
            File temp = new File(runtime, "tmp");
            if ((!home.exists() && !home.mkdirs()) || (!temp.exists() && !temp.mkdirs())) {
                throw new IllegalStateException("Could not prepare the private command workspace.");
            }
            File bash = new File(prefix, "bin/bash");
            boolean useBash = marker().isFile() && bash.canExecute();
            String shell = useBash ? bash.getAbsolutePath() : "/system/bin/sh";
            ProcessBuilder builder = new ProcessBuilder(shell, useBash ? "-lc" : "-c", command);
            builder.directory(home);
            builder.redirectErrorStream(true);
            Map<String, String> env = builder.environment();
            env.put("HOME", home.getAbsolutePath());
            env.put("TERMUX__HOME", home.getAbsolutePath());
            env.put("TERMUX_ANDROID_HOME", home.getAbsolutePath());
            env.put("PREFIX", prefix.getAbsolutePath());
            env.put("TERMUX_PREFIX", prefix.getAbsolutePath());
            env.put("TERMUX__PREFIX", prefix.getAbsolutePath());
            env.put("TERMUX__ROOTFS", runtime.getAbsolutePath());
            env.put("TERMUX_APP__PACKAGE_NAME", getContext().getPackageName());
            env.put("TMPDIR", temp.getAbsolutePath());
            env.put("PATH", new File(prefix, "bin").getAbsolutePath() + ":/system/bin:/system/xbin");
            String prefixLibraryPath = new File(prefix, "lib").getAbsolutePath();
            String oldLibraryPath = env.get("LD_LIBRARY_PATH");
            env.put("LD_LIBRARY_PATH", oldLibraryPath == null || oldLibraryPath.isEmpty()
                ? prefixLibraryPath : prefixLibraryPath + ":" + oldLibraryPath);
            env.put("SHELL", shell);
            env.put("TERM", "xterm-256color");
            env.put("LANG", "C.UTF-8");
            process = builder.start();
            final Process running = process;
            reader = new Thread(() -> {
                byte[] buffer = new byte[4096];
                try (InputStream input = running.getInputStream()) {
                    int read;
                    while ((read = input.read(buffer)) != -1) {
                        synchronized (captured) {
                            int remaining = MAX_COMMAND_OUTPUT_BYTES - captured.size();
                            if (remaining > 0) captured.write(buffer, 0, Math.min(remaining, read));
                            if (read > remaining) truncated.set(true);
                        }
                    }
                } catch (IOException ignored) { }
            }, "ultran-command-output");
            reader.start();
            boolean finished = waitForProcess(process, COMMAND_TIMEOUT_SECONDS * 1000L);
            if (!finished) {
                stopProcess(process);
                waitForProcess(process, 2000L);
            }
            reader.join(2000);
            String output;
            synchronized (captured) { output = captured.toString(StandardCharsets.UTF_8.name()); }
            if (truncated.get()) output += "\n[Output truncated at 48 KiB.]";
            if (!finished) output += "\n[Command timed out after 30 seconds and was terminated.]";
            JSObject result = new JSObject();
            result.put("approved", true);
            result.put("exitCode", finished ? process.exitValue() : -1);
            result.put("timedOut", !finished);
            result.put("output", output);
            result.put("runtimeInstalled", marker().isFile());
            call.resolve(result);
        } catch (Exception error) {
            JSObject result = new JSObject();
            result.put("approved", true);
            result.put("exitCode", -1);
            result.put("timedOut", false);
            result.put("error", error.getMessage() == null ? "Command execution failed." : error.getMessage());
            call.resolve(result);
        } finally {
            if (process != null && isProcessRunning(process)) stopProcess(process);
            if (process != null) {
                try { process.getInputStream().close(); } catch (IOException ignored) { }
            }
            if (reader != null) reader.interrupt();
        }
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

            disableIncompatiblePackageSources(staging);
            try (FileOutputStream markerOutput = new FileOutputStream(new File(staging, ".ultran-bootstrap-installed"))) {
                markerOutput.write(("termux-packages bootstrap; installed=" + System.currentTimeMillis() + "\n").getBytes(StandardCharsets.UTF_8));
                markerOutput.getFD().sync();
            }
            deleteRecursively(backup);
            boolean hadPreviousPrefix = destination.exists() || isSymbolicLink(destination);
            if (hadPreviousPrefix && !destination.renameTo(backup)) throw new IllegalStateException("Could not safely back up the existing runtime.");
            if (!staging.renameTo(destination)) {
                if (hadPreviousPrefix) backup.renameTo(destination);
                throw new IllegalStateException("Could not activate the installed runtime.");
            }
            try { deleteRecursively(backup); } catch (Exception ignored) { }
            call.resolve(new JSObject().put("installed", true).put("prefix", destination.getAbsolutePath()).put("entries", entryCount).put("uncompressedBytes", totalBytes));
        } catch (Exception error) {
            try { deleteRecursively(staging); } catch (Exception ignored) { }
            call.reject(error.getMessage() == null ? "Could not install the Termux bootstrap." : error.getMessage(), error);
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

    private boolean waitForProcess(Process process, long timeoutMillis) throws InterruptedException {
        long deadline = System.nanoTime() + timeoutMillis * 1_000_000L;
        while (System.nanoTime() < deadline) {
            if (!isProcessRunning(process)) return true;
            Thread.sleep(100L);
        }
        return !isProcessRunning(process);
    }

    private boolean isProcessRunning(Process process) {
        try {
            process.exitValue();
            return false;
        } catch (IllegalThreadStateException stillRunning) {
            return true;
        }
    }

    private void stopProcess(Process process) {
        if (android.os.Build.VERSION.SDK_INT >= 26) process.destroyForcibly();
        else process.destroy();
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
