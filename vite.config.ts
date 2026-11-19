import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["favicon.svg", "icon-192.png", "icon-512.png"],
      manifest: {
        name: "ULTIMATE OMR CHECKER AI PRO",
        short_name: "OMR Pro",
        description:
          "Genuine optical scanning, private student results and encrypted offline assessment workflows.",
        theme_color: "#0b1220",
        background_color: "#0b1220",
        display: "standalone",
        start_url: "./",
        scope: "./",
        icons: [
          {
            src: "icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        // Static shell/code/OCR/fonts only. Authenticated APIs and uploaded evidence are NEVER cached here.
        globPatterns: ["**/*.{js,mjs,css,html,woff2,svg,png,wasm,gz,ttf}"],
        maximumFileSizeToCacheInBytes: 16 * 1024 * 1024,
        navigateFallbackDenylist: [/\/api(?:\/|$)/],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: false,
        runtimeCaching: [],
      },
    }),
  ],
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY || "http://127.0.0.1:3001",
        changeOrigin: false,
      },
    },
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
