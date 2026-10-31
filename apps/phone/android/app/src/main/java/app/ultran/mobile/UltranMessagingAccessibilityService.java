package app.ultran.mobile;

import android.accessibilityservice.AccessibilityService;
import android.content.SharedPreferences;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.List;

/**
 * One-shot WhatsApp send bridge. It only acts on a message explicitly approved
 * in Ultran, verifies the exact composer text, and consumes approval before tap.
 */
public final class UltranMessagingAccessibilityService extends AccessibilityService {
    private static final String PREFS = "ultran_messaging_approval";
    private static final String KEY_TEXT = "approved_text";
    private static final String KEY_EXPIRY = "expires_at";
    private static final String WHATSAPP = "com.whatsapp";

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null || !WHATSAPP.equals(String.valueOf(event.getPackageName()))) return;
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        String expected = prefs.getString(KEY_TEXT, null);
        long expiry = prefs.getLong(KEY_EXPIRY, 0L);
        if (expected == null) return;
        if (System.currentTimeMillis() > expiry) {
            clearApproval(prefs);
            return;
        }
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return;
        try {
            if (!composerContainsExactText(root, expected)) return;
            AccessibilityNodeInfo send = findSendButton(root);
            if (send == null || !send.isEnabled()) return;
            // One-shot consume before the action to prevent duplicate sends.
            clearApproval(prefs);
            try {
                send.performAction(AccessibilityNodeInfo.ACTION_CLICK);
            } finally {
                send.recycle();
            }
        } finally {
            root.recycle();
        }
    }

    private boolean composerContainsExactText(AccessibilityNodeInfo node, String expected) {
        if (node == null) return false;
        CharSequence className = node.getClassName();
        CharSequence text = node.getText();
        if (node.isEditable() && className != null && "android.widget.EditText".contentEquals(className)
            && text != null && expected.contentEquals(text)) return true;
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                boolean match = composerContainsExactText(child, expected);
                child.recycle();
                if (match) return true;
            }
        }
        return false;
    }

    private AccessibilityNodeInfo findSendButton(AccessibilityNodeInfo root) {
        // WhatsApp's send button resource ID is more reliable than translated labels.
        List<AccessibilityNodeInfo> byId = root.findAccessibilityNodeInfosByViewId("com.whatsapp:id/send");
        if (byId != null) {
            for (AccessibilityNodeInfo node : byId) {
                if (node.isClickable() && node.isEnabled()) return node;
                node.recycle();
            }
        }
        // Fallback for WhatsApp versions with changed IDs and Arabic UI.
        for (String label : new String[]{"Send", "إرسال"}) {
            List<AccessibilityNodeInfo> matches = root.findAccessibilityNodeInfosByText(label);
            if (matches == null) continue;
            for (AccessibilityNodeInfo node : matches) {
                CharSequence description = node.getContentDescription();
                CharSequence text = node.getText();
                boolean exactLabel = (description != null && label.contentEquals(description))
                    || (text != null && label.contentEquals(text));
                if (exactLabel && node.isClickable() && node.isEnabled()) return node;
                node.recycle();
            }
        }
        return null;
    }

    private void clearApproval(SharedPreferences prefs) {
        prefs.edit().remove(KEY_TEXT).remove(KEY_EXPIRY).apply();
    }

    @Override public void onInterrupt() { }

    @Override public void onDestroy() {
        super.onDestroy();
    }
}
