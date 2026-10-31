package app.ultran.mobile;

import android.content.Context;
import android.os.SystemClock;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import androidx.work.Data;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Executes an explicitly approved local command as durable Android-scheduled work.
 * This is a bounded, non-root worker, not an always-on daemon.
 */
public final class UltranCommandWorker extends Worker {
    public static final String KEY_COMMAND = "command";
    public static final String KEY_OUTPUT = "output";
    public static final String KEY_EXIT_CODE = "exitCode";
    public static final String KEY_TIMED_OUT = "timedOut";
    public static final String KEY_ERROR = "error";
    private static final int MAX_OUTPUT_BYTES = 6 * 1024;
    private static final long MAX_RUNTIME_MS = TimeUnit.MINUTES.toMillis(4);

    public UltranCommandWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull @Override public Result doWork() {
        String command = getInputData().getString(KEY_COMMAND);
        if (command == null || command.trim().isEmpty() || command.length() > 4096 || command.indexOf('\0') >= 0) {
            return Result.failure(new Data.Builder().putString(KEY_ERROR, "Invalid or oversized command.").build());
        }

        setProgressAsync(new Data.Builder().putString("phase", "running").build());
        Process process = null;
        Thread reader = null;
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        AtomicBoolean truncated = new AtomicBoolean(false);
        try {
            Context context = getApplicationContext();
            File appData = new File("/data/data/" + context.getPackageName());
            File runtime = new File(appData, "files/ultran-runtime");
            File prefix = new File(runtime, "usr");
            File home = new File(runtime, "home");
            File temp = new File(runtime, "tmp");
            File project = new File(appData, "termux");
            File core = new File(project, "core");
            File apps = new File(project, "app");
            File appsByIdentifier = new File(apps, "i");
            File appsByUid = new File(apps, "u");
            File cache = new File(appData, "cache");
            File jobs = new File(runtime, "jobs");
            File[] directories = {home, temp, core, appsByIdentifier, appsByUid, cache, jobs};
            for (File directory : directories) {
                if (!directory.exists() && !directory.mkdirs()) {
                    return Result.failure(new Data.Builder().putString(KEY_ERROR, "Could not prepare Ultran's private runtime directories.").build());
                }
            }

            // WorkManager may reschedule interrupted work after process death. Shell
            // commands can have side effects, so claim each job ID exactly once and
            // refuse automatic replay if Android restarts this worker.
            File startedMarker = new File(jobs, getId().toString() + ".started");
            if (!startedMarker.createNewFile()) {
                return Result.failure(new Data.Builder()
                    .putString(KEY_ERROR, "This job was already started. Automatic replay was blocked to prevent duplicate side effects; submit a new approved job if needed.")
                    .build());
            }
            try (java.io.FileOutputStream markerOutput = new java.io.FileOutputStream(startedMarker)) {
                markerOutput.write("started".getBytes(java.nio.charset.StandardCharsets.UTF_8));
                markerOutput.getFD().sync();
            }

            File bash = new File(prefix, "bin/bash");
            boolean termuxReady = new File(prefix, ".ultran-bootstrap-installed").isFile() && bash.canExecute();
            if (!termuxReady) {
                return Result.failure(new Data.Builder()
                    .putString(KEY_ERROR, "The headless Termux runtime is not installed. Install the verified Ultran runtime before running local commands.")
                    .putBoolean("termuxRuntime", false)
                    .build());
            }
            String shell = bash.getAbsolutePath();
            ProcessBuilder builder = new ProcessBuilder(shell, "--login", "-c", command);
            builder.directory(home);
            builder.redirectErrorStream(true);
            Map<String, String> env = builder.environment();
            env.put("HOME", home.getAbsolutePath());
            env.put("TERMUX__HOME", home.getAbsolutePath());
            env.put("TERMUX_ANDROID_HOME", home.getAbsolutePath());
            env.put("PREFIX", prefix.getAbsolutePath());
            env.put("TERMUX_PREFIX", prefix.getAbsolutePath());
            env.put("TERMUX__PREFIX", prefix.getAbsolutePath());
            env.put("TERMUX__PREFIX_CLASSICAL", prefix.getAbsolutePath());
            env.put("TERMUX__ROOTFS", runtime.getAbsolutePath());
            env.put("TERMUX_APP__PACKAGE_NAME", context.getPackageName());
            env.put("TERMUX_APP__DATA_DIR", appData.getAbsolutePath());
            env.put("TERMUX__PROJECT_DIR", project.getAbsolutePath());
            env.put("TERMUX__CORE_DIR", core.getAbsolutePath());
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
            env.put("PATH", new File(prefix, "bin").getAbsolutePath() + ":/system/bin:/system/xbin");
            String prefixLibraryPath = new File(prefix, "lib").getAbsolutePath();
            String oldLibraryPath = env.get("LD_LIBRARY_PATH");
            env.put("LD_LIBRARY_PATH", oldLibraryPath == null || oldLibraryPath.isEmpty()
                ? prefixLibraryPath : prefixLibraryPath + ":" + oldLibraryPath);
            env.put("SHELL", shell);
            env.put("TERM", "dumb");
            env.put("LANG", "C.UTF-8");

            process = builder.start();
            final Process running = process;
            reader = new Thread(() -> {
                byte[] buffer = new byte[2048];
                try (InputStream input = running.getInputStream()) {
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        synchronized (output) {
                            int remaining = MAX_OUTPUT_BYTES - output.size();
                            if (remaining > 0) output.write(buffer, 0, Math.min(remaining, count));
                            if (count > remaining) truncated.set(true);
                        }
                    }
                } catch (Exception ignored) { }
            }, "ultran-runtime-output");
            reader.start();

            long deadline = SystemClock.elapsedRealtime() + MAX_RUNTIME_MS;
            boolean timedOut = false;
            while (true) {
                if (isStopped()) {
                    stopProcess(process);
                    return Result.failure(new Data.Builder().putString(KEY_ERROR, "Command cancelled.").build());
                }
                if (!isRunning(process)) break;
                if (SystemClock.elapsedRealtime() >= deadline) {
                    timedOut = true;
                    stopProcess(process);
                    break;
                }
                Thread.sleep(150);
            }
            reader.join(1500);
            String text;
            synchronized (output) { text = output.toString("UTF-8"); }
            if (truncated.get()) text += "\n[Output truncated at 6 KiB.]";
            if (timedOut) text += "\n[Command stopped after the 4-minute execution limit.]";
            int exitCode = timedOut ? -1 : process.exitValue();
            Data result = new Data.Builder()
                .putString(KEY_OUTPUT, text)
                .putInt(KEY_EXIT_CODE, exitCode)
                .putBoolean(KEY_TIMED_OUT, timedOut)
                .putBoolean("termuxRuntime", termuxReady)
                .build();
            postNotification("Ultran task completed", "Background command finished with exit code " + exitCode + ".");
            setProgressAsync(new Data.Builder().putString("phase", "completed").build());
            return Result.success(result);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            if (process != null) stopProcess(process);
            return Result.failure(new Data.Builder().putString(KEY_ERROR, "Command interrupted.").build());
        } catch (Exception error) {
            if (process != null) stopProcess(process);
            String message = error.getMessage() == null ? "Command execution failed." : error.getMessage();
            if (message.length() > 1000) message = message.substring(0, 1000);
            return Result.failure(new Data.Builder().putString(KEY_ERROR, message).build());
        } finally {
            if (process != null && isRunning(process)) stopProcess(process);
            if (reader != null) reader.interrupt();
        }
    }

    private boolean isRunning(Process process) {
        try { process.exitValue(); return false; }
        catch (IllegalThreadStateException running) { return true; }
    }

    private void stopProcess(Process process) {
        process.destroy();
        if (Build.VERSION.SDK_INT >= 26 && isRunning(process)) process.destroyForcibly();
    }

    private void postNotification(String title, String body) {
        Context context = getApplicationContext();
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        final String channelId = "ultran_runtime_jobs";
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(channelId, "Ultran background jobs", NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("Completion updates for approved local runtime tasks");
            manager.createNotificationChannel(channel);
        }
        NotificationCompat.Builder notification = new NotificationCompat.Builder(context, channelId)
            .setSmallIcon(context.getApplicationInfo().icon)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE);
        manager.notify(getId().hashCode(), notification.build());
    }
}
