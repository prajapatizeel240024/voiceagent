import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Frontend dev server proxies /api and /stream to the backend on :3000.
// That way we can run on http://localhost:5173 without CORS hassle.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/stream": {
        target: "ws://localhost:3000",
        ws: true,
      },
    },
  },
});
