import {
  createSessionToken,
  getAnonClient,
  getSessionSecret,
  readJson,
  sendJson,
  sessionCookie,
} from "../_lib/server.mjs";

function loginFailureMessage(error) {
  const code = error && typeof error === "object" && "code" in error
    ? error.code
    : undefined;
  const message = error instanceof Error ? error.message : "";

  if (
    code === "PGRST202" ||
    code === "42P01" ||
    code === "42703" ||
    code === "42883"
  ) {
    return "ฐานข้อมูลบัญชียังตั้งค่าไม่ครบ กรุณารัน migrations ตามลำดับใน README.md";
  }
  if (code === "42501") {
    return "Supabase ปฏิเสธสิทธิ์ (42501) กรุณาตรวจสอบสิทธิ์เรียกฟังก์ชัน verify_staff_login";
  }
  if (
    message.includes("SUPABASE_URL") ||
    message.includes("SUPABASE_ANON_KEY")
  ) {
    return "เซิร์ฟเวอร์ยังตั้งค่า environment variables ไม่ครบ กรุณาตรวจ SUPABASE_URL และ SUPABASE_ANON_KEY";
  }
  return "ระบบเข้าสู่ระบบขัดข้อง กรุณาตรวจสอบ Supabase/Vercel logs หรือลองใหม่ภายหลัง";
}

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

  try {
    const loginId = typeof body?.login_id === "string"
      ? body.login_id.trim().toLowerCase()
      : typeof body?.email === "string"
        ? body.email.trim().toLowerCase()
        : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (
      !loginId ||
      loginId.length > 254 ||
      /\s/.test(loginId) ||
      !password ||
      password.length > 1024
    ) {
      sendJson(response, 400, { error: "กรุณากรอก ID และรหัสผ่านให้ครบถ้วน" });
      return;
    }

    const client = getAnonClient();
    const { data, error } = await client.rpc("verify_staff_login", {
      p_login_id: loginId,
      p_password: password,
    });
    if (error) throw error;
    const staff = data?.[0];
    if (!staff) {
      sendJson(response, 401, { error: "ID หรือรหัสผ่านไม่ถูกต้อง" });
      return;
    }
    if (staff.status !== "active") {
      const message = {
        pending: "บัญชีสมัครแล้ว กำลังรอแอดมินอนุมัติ",
        rejected: "คำขอสมัครสมาชิกนี้ไม่ได้รับการอนุมัติ",
        suspended: "บัญชีนี้ถูกระงับการใช้งาน",
      }[staff.status] || "บัญชีนี้ยังไม่สามารถเข้าสู่ระบบได้";
      sendJson(response, 403, { error: message });
      return;
    }

    const secret = getSessionSecret();
    const token = createSessionToken(staff.id, secret);
    sendJson(
      response,
      200,
      {
        session: {
          id: staff.id,
          email: staff.email,
          display_name: staff.display_name,
          role: staff.role,
        },
      },
      { "Set-Cookie": sessionCookie(request, token) },
    );
  } catch (error) {
    console.error("Staff login failed:", error);
    sendJson(response, 500, { error: loginFailureMessage(error) });
  }
}
