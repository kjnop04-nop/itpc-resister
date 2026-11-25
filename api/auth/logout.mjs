import { clearSessionCookie, sendJson } from "../_lib/server.mjs";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed" }, { Allow: "POST" });
    return;
  }
  sendJson(response, 200, { success: true }, {
    "Set-Cookie": clearSessionCookie(request),
  });
}
