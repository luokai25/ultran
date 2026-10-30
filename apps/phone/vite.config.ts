import { defineConfig } from "vite";

export default defineConfig({
  // Relative base so the bundle resolves from the Capacitor asset origin
  // (https://localhost) as well as from a plain static host.
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020",
    sourcemap: false,
  },
  server: {
    port: 5173,
  },
});
