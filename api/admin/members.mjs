import {
  getAdminClient,
  readJson,
  sendJson,
  validUuid,
  withAuthenticatedStaff,
} from "../_lib/server.mjs";

const MANAGED_ROLES = new Set(["admin", "staff"]);
const STATUSES = new Set(["pending", "active", "rejected", "suspended"]);

export default async function handler(request, response) {
  if (!["GET", "POST", "PATCH", "DELETE"].includes(request.method)) {
    sendJson(response, 405, { error: "Method not allowed" }, { Allow: "GET, POST, PATCH, DELETE" });
    return;
  }

  await withAuthenticatedStaff(request, response, async (manager) => {
    if (manager.role !== "admin" && manager.role !== "superadmin") {
      sendJson(response, 403, { error: "ไม่มีสิทธิ์จัดการระบบ" });
      return;
    }

    const client = getAdminClient();
    if (request.method === "GET") {
      const { data, error } = await client
        .from("staff_accounts")
        .select("id, login_id, email, display_name, role, status, created_at, last_login_at")
        .in("role", ["admin", "staff"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      sendJson(response, 200, { members: data });
      return;
    }

    if (request.method === "POST") {
      let body;
      try {
        body = await readJson(request);
      } catch {
        sendJson(response, 400, { error: "ข้อมูลคำขอไม่ถูกต้อง" });
        return;
      }

      const loginId = typeof body?.login_id === "string"
        ? body.login_id.trim().toLowerCase()
        : "";
      const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
      const displayName = typeof body?.display_name === "string" ? body.display_name.trim() : "";
      const password = typeof body?.password === "string" ? body.password : "";
      const role = body?.role;
      const invalidEmail = body?.email !== undefined &&
        body.email !== null &&
        typeof body.email !== "string";
      if (
        !loginId ||
        loginId.length > 254 ||
        /\s/.test(loginId) ||
        invalidEmail ||
        (email !== "" && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)) ||
        displayName.length < 1 ||
        displayName.length > 100 ||
        password.length === 0 ||
        !MANAGED_ROLES.has(role)
      ) {
        sendJson(response, 400, { error: "กรุณากรอก ID ชื่อ รหัสผ่าน และระดับสิทธิ์ให้ถูกต้อง; อีเมลเป็นช่องไม่บังคับ" });
        return;
      }
      const { error } = await client.rpc("manager_create_staff_account", {
        p_actor_id: manager.id,
        p_login_id: loginId,
        p_email: email,
        p_display_name: displayName,
        p_password: password,
        p_role: role,
      });
      if (error?.code === "23505") {
        sendJson(response, 409, { error: "ID หรืออีเมลนี้มีบัญชีอยู่แล้ว" });
        return;
      }
      if (error?.code === "22023") {
        sendJson(response, 400, { error: "ข้อมูลบัญชีไม่ถูกต้อง" });
        return;
      }
      if (error?.code === "42501") {
        sendJson(response, 403, { error: "ไม่มีสิทธิ์สร้างบัญชีระดับนี้" });
        return;
      }
      if (error) throw error;
      sendJson(response, 201, { success: true });
      return;
    }

    if (request.method === "PATCH") {
      let body;
      try {
        body = await readJson(request);
      } catch {
        sendJson(response, 400, { error: "ข้อมูลคำขอไม่ถูกต้อง" });
        return;
      }
      if (
        !validUuid(body?.id) ||
        !MANAGED_ROLES.has(body?.role) ||
        !STATUSES.has(body?.status)
      ) {
        sendJson(response, 400, { error: "ข้อมูลบัญชีไม่ถูกต้อง" });
        return;
      }

      const { data, error } = await client.rpc("admin_update_staff_account", {
        p_actor_id: manager.id,
        p_target_id: body.id,
        p_status: body.status,
        p_role: body.role,
      });
      if (error?.code === "42501") {
        sendJson(response, 403, { error: "ไม่มีสิทธิ์จัดการบัญชีนี้ หรือไม่สามารถปิด/ลดสิทธิ์แอดมินคนสุดท้ายได้" });
        return;
      }
      if (error) throw error;
      if (!data) {
        sendJson(response, 404, { error: "ไม่พบบัญชี" });
        return;
      }
      sendJson(response, 200, { success: true });
      return;
    }

    const targetId = new URL(request.url, "http://localhost").searchParams.get("id");
    if (!validUuid(targetId)) {
      sendJson(response, 400, { error: "รหัสบัญชีไม่ถูกต้อง" });
      return;
    }
    const { data, error } = await client.rpc("admin_delete_staff_account", {
      p_actor_id: manager.id,
      p_target_id: targetId,
    });
    if (error?.code === "42501") {
      sendJson(response, 403, { error: "ไม่มีสิทธิ์ลบบัญชีนี้ หรือไม่สามารถลบแอดมินคนสุดท้ายได้" });
      return;
    }
    if (error) throw error;
    if (!data) {
      sendJson(response, 404, { error: "ไม่พบบัญชี" });
      return;
    }
    sendJson(response, 200, { success: true });
  });
}
