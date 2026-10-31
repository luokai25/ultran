package app.ultran.mobile;

import android.app.Activity;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.ScaleGestureDetector;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.termux.terminal.TerminalSession;
import com.termux.terminal.TerminalSessionClient;
import com.termux.view.TerminalView;
import com.termux.view.TerminalViewClient;

import java.io.File;
import java.util.HashMap;
import java.util.Map;

/** Native terminal UI powered by the vendored upstream Termux terminal libraries. */
public final class UltranTerminalActivity extends Activity {
    private TerminalView terminalView;
    private TerminalSession session;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        File runtime = new File("/data/data/" + getPackageName() + "/files/ultran-runtime");
        File prefix = new File(runtime, "usr");
        File home = new File(runtime, "home");
        File temp = new File(runtime, "tmp");
        if ((!prefix.exists() && !prefix.mkdirs()) ||
            (!home.exists() && !home.mkdirs()) ||
            (!temp.exists() && !temp.mkdirs())) {
            finish();
            return;
        }
        terminalView = new TerminalView(this, null);
        terminalView.setBackgroundColor(0xFF050505);
        terminalView.setTerminalViewClient(new ViewClient());
        setContentView(terminalView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));

        Map<String, String> environment = new HashMap<>(System.getenv());
        environment.put("HOME", home.getAbsolutePath());
        environment.put("TMPDIR", temp.getAbsolutePath());
        environment.put("PREFIX", prefix.getAbsolutePath());
        environment.put("TERMUX_PREFIX", prefix.getAbsolutePath());
        environment.put("TERMUX__PREFIX", prefix.getAbsolutePath());
        environment.put("TERMUX_APP__PACKAGE_NAME", getPackageName());
        environment.put("TERMUX__ROOTFS", runtime.getAbsolutePath());
        environment.put("PATH", new File(prefix, "bin").getAbsolutePath() + ":/system/bin:/system/xbin");
        environment.put("LD_LIBRARY_PATH", new File(prefix, "lib").getAbsolutePath());
        environment.put("SHELL", "/system/bin/sh");
        environment.put("TERM", "xterm-256color");
        environment.put("LANG", "C.UTF-8");
        String[] env = new String[environment.size()];
        int envIndex = 0;
        for (Map.Entry<String, String> entry : environment.entrySet()) {
            env[envIndex++] = entry.getKey() + "=" + entry.getValue();
        }
        session = new TerminalSession("/system/bin/sh", runtime.getAbsolutePath(),
            new String[] {"-i"}, env, 2000, new SessionClient());
        terminalView.attachSession(session);
        terminalView.requestFocus();
    }

    @Override protected void onDestroy() {
        if (session != null) session.finishIfRunning();
        super.onDestroy();
    }

    private final class SessionClient implements TerminalSessionClient {
        @Override public void onTextChanged(@NonNull TerminalSession changed) { runOnUiThread(() -> { if (terminalView != null) terminalView.invalidate(); }); }
        @Override public void onTitleChanged(@NonNull TerminalSession changed) { }
        @Override public void onSessionFinished(@NonNull TerminalSession finished) { }
        @Override public void onCopyTextToClipboard(@NonNull TerminalSession source, String text) { }
        @Override public void onPasteTextFromClipboard(@Nullable TerminalSession source) { }
        @Override public void onBell(@NonNull TerminalSession source) { }
        @Override public void onColorsChanged(@NonNull TerminalSession source) { }
        @Override public void onTerminalCursorStateChange(boolean state) { }
        @Override public void setTerminalShellPid(@NonNull TerminalSession source, int pid) { }
        @Override public Integer getTerminalCursorStyle() { return 0; }
        @Override public void logError(String tag, String message) { android.util.Log.e(tag, message); }
        @Override public void logWarn(String tag, String message) { android.util.Log.w(tag, message); }
        @Override public void logInfo(String tag, String message) { android.util.Log.i(tag, message); }
        @Override public void logDebug(String tag, String message) { android.util.Log.d(tag, message); }
        @Override public void logVerbose(String tag, String message) { android.util.Log.v(tag, message); }
        @Override public void logStackTraceWithMessage(String tag, String message, Exception e) { android.util.Log.e(tag, message, e); }
        @Override public void logStackTrace(String tag, Exception e) { android.util.Log.e(tag, "Terminal error", e); }
    }

    private final class ViewClient implements TerminalViewClient {
        @Override public float onScale(float scale) { return Math.max(0.5f, Math.min(scale, 2.0f)); }
        @Override public void onSingleTapUp(MotionEvent e) { if (terminalView != null) terminalView.requestFocus(); }
        @Override public boolean shouldBackButtonBeMappedToEscape() { return false; }
        @Override public boolean shouldEnforceCharBasedInput() { return false; }
        @Override public boolean shouldUseCtrlSpaceWorkaround() { return false; }
        @Override public boolean isTerminalViewSelected() { return true; }
        @Override public void copyModeChanged(boolean copyMode) { }
        @Override public boolean onKeyDown(int keyCode, KeyEvent e, TerminalSession active) { return false; }
        @Override public boolean onKeyUp(int keyCode, KeyEvent e) { return false; }
        @Override public boolean onLongPress(MotionEvent event) { return false; }
        @Override public boolean readControlKey() { return false; }
        @Override public boolean readAltKey() { return false; }
        @Override public boolean readShiftKey() { return false; }
        @Override public boolean readFnKey() { return false; }
        @Override public boolean onCodePoint(int codePoint, boolean ctrlDown, TerminalSession active) { return false; }
        @Override public void onEmulatorSet() { }
        @Override public void logError(String tag, String message) { android.util.Log.e(tag, message); }
        @Override public void logWarn(String tag, String message) { android.util.Log.w(tag, message); }
        @Override public void logInfo(String tag, String message) { android.util.Log.i(tag, message); }
        @Override public void logDebug(String tag, String message) { android.util.Log.d(tag, message); }
        @Override public void logVerbose(String tag, String message) { android.util.Log.v(tag, message); }
        @Override public void logStackTraceWithMessage(String tag, String message, Exception e) { android.util.Log.e(tag, message, e); }
        @Override public void logStackTrace(String tag, Exception e) { android.util.Log.e(tag, "Terminal view error", e); }
    }
}
