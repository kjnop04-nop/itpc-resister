import { getAdminClient, readJson, sendJson } from "../_lib/server.mjs";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed" }, { Allow: "POST" });
    return;
  }

  let body;
  try {
    body = await readJson(request);
  } catch {
    sendJson(response, 400, { error: "ข้อมูลคำขอไม่ถูกต้อง" });
    return;
  }

  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const displayName = typeof body?.display_name === "string" ? body.display_name.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 254 ||
    displayName.length < 1 ||
    displayName.length > 100 ||
    password.length < 10 ||
    password.length > 128
  ) {
    sendJson(response, 400, {
      error: "กรุณากรอกอีเมลและชื่อให้ถูกต้อง และตั้งรหัสผ่าน 10–128 ตัวอักษร",
    });
    return;
  }

  try {
    const { error } = await getAdminClient().rpc("register_staff_account", {
      p_email: email,
      p_display_name: displayName,
      p_password: password,
    });
    if (error?.code === "23505") {
      sendJson(response, 409, { error: "อีเมลนี้มีบัญชีอยู่แล้ว" });
      return;
    }
    if (error?.code === "22023") {
      sendJson(response, 400, { error: "ข้อมูลบัญชีไม่ถูกต้อง" });
      return;
    }
    if (error) throw error;
    sendJson(response, 201, { message: "สมัครสมาชิกสำเร็จ สามารถเข้าสู่ระบบได้ทันที" });
  } catch (error) {
    console.error("Staff registration failed:", error);
    sendJson(response, 500, { error: "สมัครสมาชิกไม่สำเร็จ กรุณาลองอีกครั้ง" });
  }
}
