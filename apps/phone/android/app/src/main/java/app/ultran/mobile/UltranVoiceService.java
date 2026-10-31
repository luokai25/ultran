package app.ultran.mobile;

import androidx.core.app.NotificationCompat;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.speech.tts.TextToSpeech;

import java.util.Locale;

/** Keeps a short spoken update alive while Ultran is backgrounded. */
public final class UltranVoiceService extends Service {
    private static final String CHANNEL = "ultran_voice";
    private TextToSpeech speech;
    private String pendingText;
    private boolean initialized;

    @Override public void onCreate() {
        super.onCreate();
        createChannel();
        speech = new TextToSpeech(this, status -> {
            initialized = status == TextToSpeech.SUCCESS;
            if (initialized) {
                speech.setLanguage(Locale.getDefault());
                if (pendingText != null) speakNow(pendingText);
            } else {
                stopSelf();
            }
        });
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String text = intent == null ? null : intent.getStringExtra("text");
        if (text == null || text.trim().isEmpty()) {
            stopSelf();
            return START_NOT_STICKY;
        }
        pendingText = text.trim();
        Notification notification = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(getApplicationInfo().icon)
            .setContentTitle("Ultran is speaking")
            .setContentText(pendingText.length() > 90 ? pendingText.substring(0, 87) + "..." : pendingText)
            .setOngoing(false)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
        startForeground(4107, notification);
        if (initialized) speakNow(pendingText);
        return START_NOT_STICKY;
    }

    private void speakNow(String text) {
        if (speech == null || !initialized) return;
        speech.setSpeechRate(0.94f);
        speech.setPitch(0.82f);
        speech.speak(text, TextToSpeech.QUEUE_FLUSH, null, "ultran-" + System.currentTimeMillis());
        new android.os.Handler(getMainLooper()).postDelayed(() -> {
            if (speech != null && !speech.isSpeaking()) stopSelf();
        }, Math.min(180000, Math.max(5000, text.length() * 100L)));
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "Ultran voice updates", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Foreground notification while Ultran speaks a requested update");
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
    }

    @Override public void onDestroy() {
        if (speech != null) {
            speech.stop();
            speech.shutdown();
            speech = null;
        }
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
