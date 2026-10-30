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
    // The brain is a user-chosen server on their own network, usually plain
    // http on a LAN address. The page origin is https://localhost, so without
    // this the WebView blocks every call to it as mixed content.
    allowMixedContent: true,
  },
  server: {
    androidScheme: "https",
  },
};

export default config;
