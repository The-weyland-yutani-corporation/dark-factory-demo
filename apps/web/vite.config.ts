import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://localhost:3000",
      "/healthz": "http://localhost:3000",
      "/readyz": "http://localhost:3000",
      "/version": "http://localhost:3000",
    },
  },
});
