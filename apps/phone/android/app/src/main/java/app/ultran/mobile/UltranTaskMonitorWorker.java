package app.ultran.mobile;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.work.Constraints;
import androidx.work.Data;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** OS-scheduled, network-constrained task status watcher. Android chooses exact run times. */
public final class UltranTaskMonitorWorker extends Worker {
    public static final String UNIQUE_WORK = "ultran-task-monitor";
    private static final String CHANNEL = "ultran_updates";
    private static final int MAX_RESPONSE_BYTES = 1024 * 1024;

    public UltranTaskMonitorWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    public static void schedule(Context context, String endpoint, boolean speakUpdates) {
        Data input = new Data.Builder().putString("endpoint", endpoint).putBoolean("speakUpdates", speakUpdates).build();
        Constraints constraints = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(UltranTaskMonitorWorker.class, 15, TimeUnit.MINUTES)
            .setInputData(input)
            .setConstraints(constraints)
            .build();
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(UNIQUE_WORK, androidx.work.ExistingPeriodicWorkPolicy.UPDATE, request);
    }

    public static void cancel(Context context) {
        WorkManager.getInstance(context).cancelUniqueWork(UNIQUE_WORK);
    }

    @NonNull @Override public Result doWork() {
        String endpoint = getInputData().getString("endpoint");
        if (endpoint == null || endpoint.trim().isEmpty()) return Result.failure();
        HttpURLConnection connection = null;
        try {
            Uri uri = Uri.parse(endpoint.trim());
            if (!("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme())) || uri.getHost() == null) return Result.failure();
            URL url = new URL(endpoint.trim().replaceAll("/+$", "") + "/v1/tasks?limit=100");
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(10000);
            connection.setReadTimeout(15000);
            connection.setRequestProperty("Accept", "application/json");
            int status = connection.getResponseCode();
            if (status == 408 || status == 429 || status >= 500) return Result.retry();
            if (status != 200) return Result.retry();
            try (InputStream input = connection.getInputStream()) {
                byte[] bytes = new byte[MAX_RESPONSE_BYTES + 1];
                int total = 0, count;
                while (total < bytes.length && (count = input.read(bytes, total, bytes.length - total)) != -1) total += count;
                if (total > MAX_RESPONSE_BYTES) return Result.retry();
                JSONArray tasks = new JSONArray(new String(bytes, 0, total, StandardCharsets.UTF_8));
                android.content.SharedPreferences prefs = getApplicationContext().getSharedPreferences("ultran_task_monitor", Context.MODE_PRIVATE);
                JSONObject previous = new JSONObject(prefs.getString("statuses", "{}"));
                JSONObject current = new JSONObject();
                for (int i = 0; i < Math.min(tasks.length(), 100); i++) {
                    JSONObject task = tasks.optJSONObject(i);
                    if (task == null) continue;
                    String id = task.optString("id", "");
                    String state = task.optString("status", "");
                    if (id.isEmpty() || state.isEmpty()) continue;
                    current.put(id, state);
                    String old = previous.optString(id, "");
                    if (old.isEmpty() || old.equals(state)) continue;
                    boolean done = "succeeded".equals(state);
                    boolean failed = "failed".equals(state) || "interrupted".equals(state);
                    boolean active = "running".equals(state) || "retrying".equals(state);
                    if (!done && !failed && !active) continue;
                    String title = done ? "Task completed" : failed ? "Task needs attention" : "running".equals(state) ? "Task started" : "Task retrying";
                    String objective = task.optString("message", "Ultran background task");
                    if (objective.length() > 100) objective = objective.substring(0, 97) + "...";
                    String detail = objective + (done ? " completed successfully." : failed ? " · " + state : active ? " · " + state : "");
                    postNotification(title, detail, id.hashCode());
                    if (getInputData().getBoolean("speakUpdates", false) && (done || failed)) speakUpdate(title + ". " + detail);
                }
                prefs.edit().putString("statuses", current.toString()).apply();
            }
            return Result.success();
        } catch (Exception error) {
            return Result.retry();
        } finally {
            if (connection != null) connection.disconnect();
        }
    }


    private void speakUpdate(String text) {
        CountDownLatch initialized = new CountDownLatch(1);
        CountDownLatch finished = new CountDownLatch(1);
        final TextToSpeech[] engine = new TextToSpeech[1];
        try {
            engine[0] = new TextToSpeech(getApplicationContext(), status -> {
                if (status == TextToSpeech.SUCCESS) {
                    engine[0].setLanguage(java.util.Locale.getDefault());
                    engine[0].setSpeechRate(0.94f);
                    engine[0].setPitch(0.82f);
                    engine[0].setOnUtteranceProgressListener(new UtteranceProgressListener() {
                        @Override public void onStart(String id) { }
                        @Override public void onDone(String id) { finished.countDown(); }
                        @Override public void onError(String id) { finished.countDown(); }
                    });
                }
                initialized.countDown();
            });
            if (initialized.await(8, TimeUnit.SECONDS) && engine[0] != null) {
                engine[0].speak(text, TextToSpeech.QUEUE_FLUSH, null, "ultran-worker-update");
                finished.await(25, TimeUnit.SECONDS);
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        } catch (Exception ignored) {
            // Notification delivery remains the reliable fallback.
        } finally {
            if (engine[0] != null) engine[0].shutdown();
        }
    }

    private void postNotification(String title, String body, int id) {
        Context context = getApplicationContext();
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "Ultran task updates", NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("Task milestones and completion updates from Ultran");
            manager.createNotificationChannel(channel);
        }
        NotificationCompat.Builder notification = new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(context.getApplicationInfo().icon)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT);
        manager.notify(id, notification.build());
    }
}
