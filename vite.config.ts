import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { loadEnv, type Plugin, type ViteDevServer } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import register from "./api/auth/register.mjs";
import members from "./api/admin/members.mjs";
import checkins from "./api/checkins.mjs";
import login from "./api/auth/login.mjs";
import logout from "./api/auth/logout.mjs";
import session from "./api/auth/session.mjs";
import registrations from "./api/registrations.mjs";

const apiRoutes = new Map([
  ["/api/auth/login", login],
  ["/api/auth/register", register],
  ["/api/auth/logout", logout],
  ["/api/auth/session", session],
  ["/api/admin/members", members],
  ["/api/registrations", registrations],
  ["/api/checkins", checkins],
]);

function localApiPlugin(): Plugin {
  return {
    name: "local-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use((
        request: IncomingMessage,
        response: ServerResponse,
        next: (error?: Error) => void,
      ) => {
        const path = new URL(request.url || "/", "http://localhost").pathname;
        const handler = apiRoutes.get(path);
        if (!handler) {
          next();
          return;
        }
        void handler(request, response).catch((error: unknown) => {
          console.error("Local API request failed:", error);
          if (!response.headersSent) {
            response.statusCode = 500;
            response.setHeader("Content-Type", "application/json; charset=utf-8");
            response.end(JSON.stringify({ error: "เกิดข้อผิดพลาดในการเชื่อมต่อระบบ" }));
          }
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  for (const key of Object.keys(env)) {
    if (process.env[key] === undefined) process.env[key] = env[key];
  }

  return {
    plugins: [react(), localApiPlugin()],
    test: {
      environment: "node",
    },
  };
});
