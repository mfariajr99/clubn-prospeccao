import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": `http://localhost:${process.env.API_PORT ?? 3333}` },
  },
  preview: { port: 4173, proxy: { "/api": `http://localhost:${process.env.API_PORT ?? 3333}` } },
  build: { outDir: "dist", chunkSizeWarningLimit: 900 },
  worker: { format: "es" },
  test: {
    globals: false,
    setupFiles: ["tests/setup.ts"],
    include: ["tests/{shared,server,client}/**/*.test.{ts,tsx}"],
    environment: "node",
    testTimeout: 15000,
  },
});
