import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// In dev, API calls go to the same origin and Vite forwards them to FastAPI,
// so you never have to think about CORS locally.
// Change the target with VITE_PROXY_TARGET in .env (default http://localhost:8000).
const API_PREFIXES = ["/auth", "/checkin", "/walkin", "/queue", "/tokens", "/departments", "/health"];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.VITE_PROXY_TARGET || "http://localhost:8000";
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: Object.fromEntries(
        API_PREFIXES.map((p) => [p, { target, changeOrigin: true }])
      ),
    },
  };
});
