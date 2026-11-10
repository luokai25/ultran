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
    // Keep the 3D avatar engine and native bridge out of the application
    // entry chunk. This reduces the entry bundle's parse/compile burden and
    // lets the browser cache these dependency groups independently.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/node_modules/three/")) return "three";
          if (id.includes("/node_modules/@capacitor/")) return "capacitor";
          if (id.includes("/node_modules/pdfjs-dist/")) return "pdf";
          if (id.includes("/node_modules/mammoth/")) return "documents";
          if (id.includes("/node_modules/@supabase/")) return "supabase";
        },
      },
    },
  },
  server: {
    port: 5173,
  },
});
