package app.ultran.mobile;

import android.Manifest;
import android.app.AlertDialog;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "UltranCompanion")
public final class UltranCompanionPlugin extends Plugin {
    private static final int NOTIFICATION_PERMISSION_REQUEST = 4108;
    private static final String CHANNEL = "ultran_updates";

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            call.resolve(new JSObject().put("granted", true));
            return;
        }
        ActivityCompat.requestPermissions(getActivity(), new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION_REQUEST);
        call.resolve(new JSObject().put("granted", false).put("requested", true));
    }

    @PluginMethod
    public void notify(PluginCall call) {
        String title = call.getString("title", "Ultran update");
        String body = call.getString("body", "");
        if (body.trim().isEmpty()) { call.reject("Notification text cannot be empty."); return; }
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            call.reject("Notification permission has not been granted.");
            return;
        }
        NotificationManager manager = (NotificationManager) getContext().getSystemService(android.content.Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "Ultran task updates", NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("Task milestones, reminders and important Ultran updates");
            manager.createNotificationChannel(channel);
        }
        NotificationCompat.Builder builder = new NotificationCompat.Builder(getContext(), CHANNEL)
            .setSmallIcon(getContext().getApplicationInfo().icon)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT);
        manager.notify((int) (System.currentTimeMillis() & 0x7fffffff), builder.build());
        call.resolve(new JSObject().put("posted", true));
    }

    @PluginMethod
    public void startTaskMonitor(PluginCall call) {
        String endpoint = call.getString("endpoint", "").trim().replaceAll("/+$", "");
        android.net.Uri uri = android.net.Uri.parse(endpoint);
        if (endpoint.isEmpty() || uri.getHost() == null || !("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme()))) {
            call.reject("Configure a valid HTTP or HTTPS backend URL first.");
            return;
        }
        try {
            UltranTaskMonitorWorker.schedule(getContext(), endpoint);
            call.resolve(new JSObject().put("scheduled", true).put("minimumIntervalMinutes", 15));
        } catch (Exception error) {
            call.reject("Could not schedule background task monitoring.", error);
        }
    }

    @PluginMethod
    public void stopTaskMonitor(PluginCall call) {
        try {
            UltranTaskMonitorWorker.cancel(getContext());
            call.resolve(new JSObject().put("stopped", true));
        } catch (Exception error) {
            call.reject("Could not stop background task monitoring.", error);
        }
    }

    @PluginMethod
    public void composeSms(PluginCall call) {
        String number = call.getString("number", "").trim();
        String body = call.getString("body", "").trim();
        if (number.isEmpty() || number.length() > 40 || body.isEmpty() || body.length() > 4000) {
            call.reject("Provide a phone number and a message of up to 4,000 characters.");
            return;
        }
        getActivity().runOnUiThread(() -> new AlertDialog.Builder(getActivity())
            .setTitle("Review text message")
            .setMessage("Ultran wants to open your messaging app with this message prepared. Nothing will be sent until you press Send there.\n\nTo: " + number + "\n\n" + body)
            .setPositiveButton("Open messages", (dialog, which) -> {
                Intent intent = new Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + Uri.encode(number)));
                intent.putExtra("sms_body", body);
                try {
                    getActivity().startActivity(intent);
                    call.resolve(new JSObject().put("opened", true).put("sent", false));
                } catch (Exception error) {
                    call.reject("No compatible messaging app is available.", error);
                }
            })
            .setNegativeButton("Cancel", (dialog, which) -> call.resolve(new JSObject().put("opened", false).put("sent", false)))
            .show());
    }

    @PluginMethod
    public void speakInBackground(PluginCall call) {
        String text = call.getString("text", "").trim();
        if (text.isEmpty() || text.length() > 1800) { call.reject("Speech text must be between 1 and 1,800 characters."); return; }
        Intent intent = new Intent(getContext(), UltranVoiceService.class);
        intent.putExtra("text", text);
        try {
            ContextCompat.startForegroundService(getContext(), intent);
            call.resolve(new JSObject().put("started", true));
        } catch (Exception error) {
            call.reject("Could not start background voice. Check Android notification and battery settings.", error);
        }
    }

    @PluginMethod
    public void stopBackgroundSpeech(PluginCall call) {
        getContext().stopService(new Intent(getContext(), UltranVoiceService.class));
        call.resolve(new JSObject().put("stopped", true));
    }
}
