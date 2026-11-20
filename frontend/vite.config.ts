import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");

  return {
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
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      hmr: {
        overlay: true,
      },
      watch: {
        // Enable for folders where native filesystem events aren't delivered.
        usePolling: env.VITE_USE_POLLING === "1",
        interval: 200,
      },
      proxy: {
        "/api": "http://127.0.0.1:8000",
        "/socket.io": { target: "http://127.0.0.1:3001", ws: true },
      },
    },
  };
});
