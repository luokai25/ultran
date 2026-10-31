package app.ultran.mobile;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(UltranLocalAiPlugin.class);
        registerPlugin(UltranTerminalPlugin.class);
        registerPlugin(UltranRuntimePlugin.class);
        registerPlugin(UltranCompanionPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
