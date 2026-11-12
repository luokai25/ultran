package app.ultron.mobile;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(UltronLocalAiPlugin.class);
        registerPlugin(UltronRuntimePlugin.class);
        registerPlugin(UltronCompanionPlugin.class);
        registerPlugin(UltronSecureStoragePlugin.class);
        registerPlugin(UltronProviderHttpPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
