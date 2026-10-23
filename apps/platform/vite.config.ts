import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 5174,
      strictPort: true,
      proxy: {
        "/api": { target: env.VITE_PROXY_TARGET ?? "http://localhost:9000", changeOrigin: true },
      },
    },
    preview: { host: "127.0.0.1", port: 4174 },
    test: { environment: "jsdom", setupFiles: "./src/test/setup.ts", globals: true },
  };
});
