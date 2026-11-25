import {
  getAdminClient,
  readJson,
  sendJson,
  validUuid,
  withAdministrator,
} from "../_lib/server.mjs";

const ROLES = new Set(["admin", "staff"]);
const STATUSES = new Set(["pending", "active", "rejected", "suspended"]);

export default async function handler(request, response) {
  if (!["GET", "PATCH", "DELETE"].includes(request.method)) {
    sendJson(response, 405, { error: "Method not allowed" }, { Allow: "GET, PATCH, DELETE" });
    return;
  }

  await withAdministrator(request, response, async (admin) => {
    const client = getAdminClient();
    if (request.method === "GET") {
      const { data, error } = await client
        .from("staff_accounts")
        .select("id, email, display_name, role, status, created_at, last_login_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      sendJson(response, 200, { members: data });
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
        !ROLES.has(body?.role) ||
        !STATUSES.has(body?.status)
      ) {
        sendJson(response, 400, { error: "ข้อมูลสมาชิกไม่ถูกต้อง" });
        return;
      }

      const { data, error } = await client.rpc("admin_update_staff_account", {
        p_actor_id: admin.id,
        p_target_id: body.id,
        p_status: body.status,
        p_role: body.role,
      });
      if (error?.code === "42501") {
        sendJson(response, 409, { error: "ไม่สามารถเปลี่ยนสิทธิ์แอดมินคนสุดท้ายหรือปิดบัญชีตัวเองได้" });
        return;
      }
      if (error) throw error;
      if (!data) {
        sendJson(response, 404, { error: "ไม่พบบัญชีสมาชิก" });
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
      p_actor_id: admin.id,
      p_target_id: targetId,
    });
    if (error?.code === "42501") {
      sendJson(response, 409, { error: "ไม่สามารถลบบัญชีแอดมินคนสุดท้ายหรือลบบัญชีตัวเองได้" });
      return;
    }
    if (error) throw error;
    if (!data) {
      sendJson(response, 404, { error: "ไม่พบบัญชีสมาชิก" });
      return;
    }
    sendJson(response, 200, { success: true });
  });
}
