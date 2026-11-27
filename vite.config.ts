import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { loadEnv, type Plugin, type ViteDevServer, type PreviewServer } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import register from "./api/auth/register.mjs";
import members from "./api/admin/members.mjs";
import checkins from "./api/checkins.mjs";
import login from "./api/auth/login.mjs";
import logout from "./api/auth/logout.mjs";
import session from "./api/auth/session.mjs";
import registrations from "./api/registrations.mjs";
import importRegistrations from "./api/registrations/import.mjs";
import exportRegistrations from "./api/registrations/export.mjs";
import dashboard from "./api/dashboard.mjs";
import academicYears from "./api/academic-years.mjs";

const apiRoutes = new Map([
  ["/api/auth/login", login],
  ["/api/auth/register", register],
  ["/api/auth/logout", logout],
  ["/api/auth/session", session],
  ["/api/admin/members", members],
  ["/api/registrations", registrations],
  ["/api/registrations/import", importRegistrations],
  ["/api/registrations/export", exportRegistrations],
  ["/api/dashboard", dashboard],
  ["/api/academic-years", academicYears],
  ["/api/checkins", checkins],
]);

function localApiPlugin(): Plugin {
  const attachApiMiddleware = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use((
      request: IncomingMessage,
      response: ServerResponse,
      next: (error?: Error) => void,
    ) => {
      let path = new URL(request.url || "/", "http://localhost").pathname;
      if (path.startsWith("/itpc-register")) {
        path = path.slice("/itpc-register".length);
      }
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
  };

  return {
    name: "local-api",
    configureServer(server: ViteDevServer) {
      attachApiMiddleware(server);
    },
    configurePreviewServer(server: PreviewServer) {
      attachApiMiddleware(server);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  for (const key of Object.keys(env)) {
    if (process.env[key] === undefined) process.env[key] = env[key];
  }

  return {
    base: "/itpc-register/",
    server: {
      port: 3016,
      host: true,
      strictPort: true,
      allowedHosts: true,
    },
    preview: {
      port: 3016,
      host: true,
      strictPort: true,
      allowedHosts: true,
    },
    plugins: [react(), localApiPlugin()],
    test: {
      environment: "node",
    },
  };
});
