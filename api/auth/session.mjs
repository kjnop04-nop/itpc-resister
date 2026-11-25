import { authenticatedStaff, sendJson } from "../_lib/server.mjs";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed" }, { Allow: "GET" });
    return;
  }

  try {
    sendJson(response, 200, { session: await authenticatedStaff(request) });
  } catch (error) {
    console.error("Could not read staff session:", error);
    sendJson(response, 500, { error: "ตรวจสอบสถานะเข้าสู่ระบบไม่สำเร็จ" });
  }
}
