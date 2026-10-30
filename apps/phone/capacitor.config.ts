import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The phone shell.
 *
 * `androidScheme: 'https'` is load-bearing: with the default `file://` origin the
 * WebView enforces CORS on ES-module imports and the app renders a blank screen.
 * With `https` the origin becomes `https://localhost`, which the module graph and
 * the fetch calls to the local control plane both accept.
 */
const config: CapacitorConfig = {
  appId: "app.ultran.mobile",
  appName: "Ultran",
  webDir: "dist",
  android: {
    backgroundColor: "#050505",
    allowMixedContent: false,
  },
  server: {
    androidScheme: "https",
  },
};

export default config;
