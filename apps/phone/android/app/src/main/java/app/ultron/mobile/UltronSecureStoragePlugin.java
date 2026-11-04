package app.ultron.mobile;

import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "UltronSecureStorage")
public final class UltronSecureStoragePlugin extends Plugin {
    private static final String PREFS = "ultron_secure_values";
    private static final String KEY_ALIAS = "ultron_cloud_auth_aes_gcm_v1";
    private static final int GCM_TAG_BITS = 128;
    private static final int GCM_IV_BYTES = 12;
    private static final int MAX_VALUE_BYTES = 32768;

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE);
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        java.security.Key existing = keyStore.getKey(KEY_ALIAS, null);
        if (existing instanceof SecretKey) return (SecretKey) existing;

        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .setUserAuthenticationRequired(false)
            .build());
        return generator.generateKey();
    }

    @PluginMethod
    public void get(PluginCall call) {
        String key = call.getString("key", "").trim();
        if (key.isEmpty() || key.length() > 128) {
            call.reject("Secure storage key must contain 1 to 128 characters.");
            return;
        }
        String encoded = preferences().getString(key, null);
        if (encoded == null) {
            call.resolve(new JSObject().put("value", JSONObject.NULL));
            return;
        }
        try {
            byte[] payload = Base64.decode(encoded, Base64.NO_WRAP);
            if (payload.length <= GCM_IV_BYTES) throw new IllegalStateException("Stored secure value is malformed.");
            byte[] iv = java.util.Arrays.copyOfRange(payload, 0, GCM_IV_BYTES);
            byte[] ciphertext = java.util.Arrays.copyOfRange(payload, GCM_IV_BYTES, payload.length);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(GCM_TAG_BITS, iv));
            byte[] plaintext = cipher.doFinal(ciphertext);
            call.resolve(new JSObject().put("value", new String(plaintext, StandardCharsets.UTF_8)));
        } catch (Exception error) {
            call.reject("Could not decrypt the ULTRON secure session value.", error);
        }
    }

    @PluginMethod
    public void set(PluginCall call) {
        String key = call.getString("key", "").trim();
        String value = call.getString("value", "");
        if (key.isEmpty() || key.length() > 128 || value == null || value.getBytes(StandardCharsets.UTF_8).length > MAX_VALUE_BYTES) {
            call.reject("Secure storage key or value is invalid or too large.");
            return;
        }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
            byte[] iv = cipher.getIV();
            byte[] ciphertext = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            byte[] payload = new byte[iv.length + ciphertext.length];
            System.arraycopy(iv, 0, payload, 0, iv.length);
            System.arraycopy(ciphertext, 0, payload, iv.length, ciphertext.length);
            String encoded = Base64.encodeToString(payload, Base64.NO_WRAP);
            boolean saved = preferences().edit().putString(key, encoded).commit();
            if (!saved) throw new IllegalStateException("Android could not persist the encrypted value.");
            call.resolve(new JSObject().put("stored", true));
        } catch (Exception error) {
            call.reject("Could not encrypt and store the ULTRON secure session value.", error);
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String key = call.getString("key", "").trim();
        if (key.isEmpty() || key.length() > 128) {
            call.reject("Secure storage key must contain 1 to 128 characters.");
            return;
        }
        boolean removed = preferences().edit().remove(key).commit();
        if (!removed) {
            call.reject("Android could not remove the secure value.");
            return;
        }
        call.resolve(new JSObject().put("removed", true));
    }
}
