import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1300
  },
  server: {
    port: 5173,
    allowedHosts: ["myceliummarket.josh.software"],
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true
      }
    }
  },
  preview: {
    allowedHosts: ["myceliummarket.josh.software"]
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./test/setup.ts"
  }
});
