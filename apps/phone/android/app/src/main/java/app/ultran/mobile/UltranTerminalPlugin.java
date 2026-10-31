package app.ultran.mobile;

import android.content.Intent;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "UltranTerminal")
public final class UltranTerminalPlugin extends Plugin {
    @PluginMethod
    public void open(PluginCall call) {
        try {
            getActivity().runOnUiThread(() -> {
                getActivity().startActivity(new Intent(getContext(), UltranTerminalActivity.class));
                call.resolve();
            });
        } catch (Exception error) {
            call.reject("Could not open Ultran's built-in terminal.", error);
        }
    }
}
