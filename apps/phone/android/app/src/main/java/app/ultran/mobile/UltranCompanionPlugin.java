package app.ultran.mobile;

import android.Manifest;
import android.app.AlertDialog;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.text.TextUtils;

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
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(new NotificationCompat.Builder(getContext(), CHANNEL)
                .setSmallIcon(getContext().getApplicationInfo().icon)
                .setContentTitle("Ultran update")
                .setContentText("Open Ultran to view details.")
                .build())
            .setPriority(NotificationCompat.PRIORITY_DEFAULT);
        manager.notify((int) (System.currentTimeMillis() & 0x7fffffff), builder.build());
        call.resolve(new JSObject().put("posted", true));
    }

    @PluginMethod
    public void startTaskMonitor(PluginCall call) {
        String endpoint = call.getString("endpoint", "").trim().replaceAll("/+$", "");
        boolean speakUpdates = call.getBoolean("speakUpdates", false);
        android.net.Uri uri = android.net.Uri.parse(endpoint);
        if (endpoint.isEmpty() || uri.getHost() == null || !("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme()))) {
            call.reject("Configure a valid HTTP or HTTPS backend URL first.");
            return;
        }
        try {
            UltranTaskMonitorWorker.schedule(getContext(), endpoint, speakUpdates);
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
    public void openWhatsAppMessage(PluginCall call) {
        String rawNumber = call.getString("number", "").trim();
        String body = call.getString("body", "").trim();
        String number = rawNumber.replaceAll("[^0-9]", "");
        if (number.length() < 7 || number.length() > 15 || body.isEmpty() || body.length() > 4000) {
            call.reject("Provide an international phone number and a message of up to 4,000 characters.");
            return;
        }
        String component = getContext().getPackageName() + "/" + UltranMessagingAccessibilityService.class.getName();
        String enabled = Settings.Secure.getString(getContext().getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        boolean serviceEnabled = enabled != null && enabled.contains(component);
        if (!serviceEnabled) {
            getActivity().runOnUiThread(() -> new AlertDialog.Builder(getActivity())
                .setTitle("Enable Ultran phone actions")
                .setMessage("To send an approved WhatsApp message, Android requires you to enable Ultran's Accessibility Service. It only acts on a WhatsApp message after you approve its exact recipient and text in Ultran. You can disable it any time in Android Accessibility settings.")
                .setPositiveButton("Open Accessibility settings", (dialog, which) -> {
                    getActivity().startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
                    call.resolve(new JSObject().put("openedSettings", true).put("sent", false));
                })
                .setNegativeButton("Cancel", (dialog, which) -> call.resolve(new JSObject().put("openedSettings", false).put("sent", false)))
                .show());
            return;
        }
        if (getContext().getPackageManager().getLaunchIntentForPackage("com.whatsapp") == null) {
            call.reject("WhatsApp is not installed. Install it or use the SMS handoff.");
            return;
        }
        getActivity().runOnUiThread(() -> new AlertDialog.Builder(getActivity())
            .setTitle("Approve WhatsApp message")
            .setMessage("Send this exact message to +"+number+" using WhatsApp?\n\n"+body+"\n\nUltran will open WhatsApp and tap Send once. This approval expires after 60 seconds.")
            .setPositiveButton("Approve and send", (dialog, which) -> {
                getContext().getSharedPreferences("ultran_messaging_approval", android.content.Context.MODE_PRIVATE)
                    .edit().putString("approved_text", body)
                    .putLong("expires_at", System.currentTimeMillis() + 60000L).apply();
                try {
                    String url = "https://wa.me/" + number + "?text=" + Uri.encode(body);
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    intent.setPackage("com.whatsapp");
                    getActivity().startActivity(intent);
                    call.resolve(new JSObject().put("opened", true).put("approved", true).put("sent", "pending_confirmation_in_whatsapp"));
                } catch (Exception error) {
                    getContext().getSharedPreferences("ultran_messaging_approval", android.content.Context.MODE_PRIVATE).edit().clear().apply();
                    call.reject("Could not open WhatsApp. The one-use approval was cancelled.", error);
                }
            })
            .setNegativeButton("Cancel", (dialog, which) -> call.resolve(new JSObject().put("opened", false).put("approved", false).put("sent", false)))
            .show());
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
    public void composeWhatsApp(PluginCall call) {
        String recipient = call.getString("number", "").replaceAll("[^0-9]", "");
        String body = call.getString("body", "").trim();
        if (recipient.length() < 7 || recipient.length() > 15 || body.isEmpty() || body.length() > 4000) {
            call.reject("Provide a WhatsApp number with country code and a message up to 4,000 characters.");
            return;
        }
        Uri target = Uri.parse("https://wa.me/" + recipient).buildUpon()
            .appendQueryParameter("text", body).build();
        getActivity().runOnUiThread(() -> new AlertDialog.Builder(getActivity())
            .setTitle("Review WhatsApp message")
            .setMessage("Ultran wants to open WhatsApp with this message prepared. Nothing will be sent until you press Send in WhatsApp.\n\nTo: +" + recipient + "\n\n" + body)
            .setPositiveButton("Open WhatsApp", (dialog, which) -> {
                Intent intent = new Intent(Intent.ACTION_VIEW, target);
                intent.setPackage("com.whatsapp");
                try {
                    getActivity().startActivity(intent);
                    call.resolve(new JSObject().put("opened", true).put("sent", false));
                } catch (Exception error) {
                    Intent fallback = new Intent(Intent.ACTION_VIEW, target);
                    try {
                        getActivity().startActivity(fallback);
                        call.resolve(new JSObject().put("opened", true).put("sent", false).put("fallback", true));
                    } catch (Exception fallbackError) {
                        call.reject("WhatsApp or a compatible link handler is not installed.", fallbackError);
                    }
                }
            })
            .setNegativeButton("Cancel", (dialog, which) -> call.resolve(new JSObject().put("opened", false).put("sent", false)))
            .show());
    }

    @PluginMethod
    public void openApp(PluginCall call) {
        String app = call.getString("app", "").trim().toLowerCase(java.util.Locale.ROOT);
        String label;
        String packageName;
        switch (app) {
            case "whatsapp": label = "WhatsApp"; packageName = "com.whatsapp"; break;
            case "whatsapp-business": label = "WhatsApp Business"; packageName = "com.whatsapp.w4b"; break;
            case "telegram": label = "Telegram"; packageName = "org.telegram.messenger"; break;
            case "messages": label = "Messages"; packageName = "com.google.android.apps.messaging"; break;
            case "gmail": label = "Gmail"; packageName = "com.google.android.gm"; break;
            case "phone": label = "Phone"; packageName = "com.google.android.dialer"; break;
            case "calendar": label = "Calendar"; packageName = "com.google.android.calendar"; break;
            default: call.reject("This app is not in Ultran's approved launch list."); return;
        }
        final String chosenLabel = label;
        final String chosenPackage = packageName;
        getActivity().runOnUiThread(() -> new AlertDialog.Builder(getActivity())
            .setTitle("Open " + chosenLabel + "?")
            .setMessage("Ultran is asking permission to open " + chosenLabel + ".")
            .setPositiveButton("Open app", (dialog, which) -> {
                Intent launch = getContext().getPackageManager().getLaunchIntentForPackage(chosenPackage);
                if (launch == null) { call.reject(chosenLabel + " is not installed or cannot be opened."); return; }
                try {
                    getActivity().startActivity(launch);
                    call.resolve(new JSObject().put("opened", true).put("app", app));
                } catch (Exception error) { call.reject("Could not open " + chosenLabel + ".", error); }
            })
            .setNegativeButton("Cancel", (dialog, which) -> call.resolve(new JSObject().put("opened", false)))
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
