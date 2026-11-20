import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          motion: ["framer-motion"],
          realtime: ["socket.io-client"],
          query: ["@tanstack/react-query"],
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/socket.io": { target: "http://127.0.0.1:3001", ws: true },
    },
  },
});
