import { sendJson } from "../_lib/server.mjs";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed" }, { Allow: "POST" });
    return;
  }

  sendJson(response, 410, {
    error: "ปิดการสมัครสมาชิกด้วยตนเองแล้ว กรุณาติดต่อแอดมินเพื่อขอบัญชี",
  });
}
