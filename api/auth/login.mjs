import {
  createSessionToken,
  getAdminClient,
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
    return "ฐานข้อมูลบัญชียังตั้งค่าไม่ครบ กรุณารัน migrations ทั้ง 5 ไฟล์ตามลำดับใน README.md";
  }
  if (
    message.includes("SUPABASE_URL") ||
    message.includes("SUPABASE_SERVICE_ROLE_KEY") ||
    message.includes("SESSION_SECRET")
  ) {
    return "เซิร์ฟเวอร์ยังตั้งค่า environment variables ไม่ครบ กรุณาตรวจ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY และ SESSION_SECRET";
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
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!email || !password || password.length > 1024) {
      sendJson(response, 400, { error: "กรุณากรอกอีเมลและรหัสผ่านให้ครบถ้วน" });
      return;
    }

    const client = getAdminClient();
    const { data, error } = await client.rpc("verify_staff_login", {
      p_email: email,
      p_password: password,
    });
    if (error) throw error;
    const staff = data?.[0];
    if (!staff) {
      sendJson(response, 401, { error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
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

    const { error: updateError } = await client
      .from("staff_accounts")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", staff.id);
    if (updateError) throw updateError;

    const secret = process.env.SESSION_SECRET;
    if (!secret || secret.length < 32) {
      throw new Error("SESSION_SECRET must contain at least 32 characters");
    }
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
