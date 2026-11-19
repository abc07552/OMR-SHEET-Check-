import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: { "/api": { target: "http://127.0.0.1:3001", changeOrigin: false } },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (
            /recharts|d3-|react-smooth|decimal.js|lodash|eventemitter3|internmap/.test(
              id,
            )
          )
            return "charts";
          if (/\/react(?:-dom|-is)?\/|scheduler/.test(id))
            return "react-vendor";
        },
      },
    },
  },
});
