import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // One origin for pages and data, so the browser never deals with CORS.
    proxy: { "/api": { target: "http://localhost:8787", changeOrigin: true } },
  },
});
