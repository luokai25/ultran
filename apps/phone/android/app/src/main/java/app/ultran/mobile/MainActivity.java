package app.ultran.mobile;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(UltranLocalAiPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
