import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Backend target is configurable so the dev server can point at a non-default port.
const apiTarget = process.env.VITE_API_PROXY ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": apiTarget,
    },
  },
});
