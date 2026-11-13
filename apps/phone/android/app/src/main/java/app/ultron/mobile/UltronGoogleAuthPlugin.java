package app.ultron.mobile;

import android.app.PendingIntent;
import android.content.Intent;
import android.content.IntentSender;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;

import java.util.ArrayList;
import java.util.List;

/**
 * Google account authorization for ULTRON plugins, using Google Play services' Identity Authorization API.
 * There is no redirect URI, client secret or backend: Google matches this app by package name and signing
 * certificate. The first call per scope set shows Google's consent sheet. After the user has consented, later
 * calls return a fresh access token silently, which is how a plugin stays connected until it is removed.
 * Tokens are returned to the caller and are never persisted by this plugin.
 */
@CapacitorPlugin(name = "UltronGoogleAuth", requestCodes = { UltronGoogleAuthPlugin.REQUEST_AUTHORIZE })
public final class UltronGoogleAuthPlugin extends Plugin {
    static final int REQUEST_AUTHORIZE = 9701;
    private PluginCall pendingCall;

    @PluginMethod
    public void authorize(PluginCall call) {
        JSArray raw = call.getArray("scopes");
        List<Scope> scopes = new ArrayList<>();
        try {
            if (raw != null) {
                for (int i = 0; i < raw.length(); i++) {
                    String scope = raw.getString(i);
                    if (scope != null && scope.startsWith("https://www.googleapis.com/auth/")) scopes.add(new Scope(scope));
                }
            }
        } catch (Exception error) {
            call.reject("Invalid scope list.", "invalid_scopes");
            return;
        }
        if (scopes.isEmpty() || scopes.size() > 12) {
            call.reject("A plugin must request between one and twelve Google scopes.", "invalid_scopes");
            return;
        }
        if (getActivity() == null) {
            call.reject("ULTRON is not in the foreground.", "no_activity");
            return;
        }
        AuthorizationRequest request = AuthorizationRequest.builder().setRequestedScopes(scopes).build();
        Identity.getAuthorizationClient(getActivity())
            .authorize(request)
            .addOnSuccessListener(result -> {
                if (result.hasResolution()) {
                    PendingIntent pending = result.getPendingIntent();
                    if (pending == null) { call.reject("Google did not provide a consent screen.", "no_resolution"); return; }
                    pendingCall = call;
                    try {
                        getActivity().startIntentSenderForResult(pending.getIntentSender(), REQUEST_AUTHORIZE, null, 0, 0, 0);
                    } catch (IntentSender.SendIntentException error) {
                        pendingCall = null;
                        call.reject("Could not open Google's consent screen.", "consent_failed");
                    }
                } else {
                    resolveWith(call, result);
                }
            })
            .addOnFailureListener(error -> rejectWith(call, error));
    }

    @Override
    protected void handleOnActivityResult(int requestCode, int resultCode, Intent data) {
        super.handleOnActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_AUTHORIZE) return;
        PluginCall call = pendingCall;
        pendingCall = null;
        if (call == null) return;
        if (resultCode != android.app.Activity.RESULT_OK || data == null) {
            call.reject("Google authorization was cancelled.", "cancelled");
            return;
        }
        try {
            AuthorizationResult result = Identity.getAuthorizationClient(getActivity()).getAuthorizationResultFromIntent(data);
            resolveWith(call, result);
        } catch (ApiException error) {
            rejectWith(call, error);
        }
    }

    private static void resolveWith(PluginCall call, AuthorizationResult result) {
        String token = result.getAccessToken();
        if (token == null || token.isEmpty()) { call.reject("Google did not return an access token.", "no_token"); return; }
        JSArray granted = new JSArray();
        List<String> scopes = result.getGrantedScopes();
        if (scopes != null) for (String scope : scopes) granted.put(scope);
        JSObject out = new JSObject();
        out.put("accessToken", token);
        out.put("grantedScopes", granted);
        call.resolve(out);
    }

    private static void rejectWith(PluginCall call, Exception error) {
        int status = error instanceof ApiException ? ((ApiException) error).getStatusCode() : -1;
        String code;
        String message;
        if (status == 10 || status == 12500) {
            code = "developer_error";
            message = "Google does not recognise this build of ULTRON. Add an Android OAuth client for package app.ultron.mobile with this build's signing SHA-1 in Google Cloud.";
        } else if (status == 16 || status == 12501) {
            code = "cancelled";
            message = "Google authorization was cancelled.";
        } else if (status == 7 || status == 8) {
            code = "network";
            message = "Could not reach Google. Check the connection and try again.";
        } else if (status == 17) {
            code = "unavailable";
            message = "Google Play services is not available on this device, so Google sign-in cannot run here.";
        } else {
            code = "failed";
            message = "Google authorization failed" + (status >= 0 ? " (code " + status + ")." : ".");
        }
        call.reject(message, code);
    }
}
