import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "client",
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": "http://localhost:5050",
      "/assets": "http://localhost:5050"
    }
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true
  }
});
