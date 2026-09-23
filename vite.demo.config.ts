// Clickable demo: single self-contained HTML (no server) with the real API
// logic running in the browser on sql.js. Output: dist-demo/demo.html
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [react(), viteSingleFile({ removeViteModuleLoader: true })],
  define: { "import.meta.env.VITE_DEMO": JSON.stringify("true") },
  build: {
    outDir: "dist-demo",
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 10_000,
    rollupOptions: { input: "demo.html" },
  },
  worker: { format: "es" },
});
