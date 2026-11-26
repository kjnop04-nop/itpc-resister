import { getAdminClient, sendJson, withAuthenticatedStaff } from "./_lib/server.mjs";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed" }, { Allow: "GET" });
    return;
  }

  await withAuthenticatedStaff(request, response, async () => {
    const params = new URL(request.url, "http://localhost").searchParams;
    const query = params.get("q")?.trim() || "";
    if (query.length > 100) {
      sendJson(response, 400, { error: "กรุณากรอกคำค้นหาไม่เกิน 100 ตัวอักษร" });
      return;
    }

    if (!query) {
      const groupNumberParam = params.get("group_number");
      const groupNumber = groupNumberParam === null ? null : Number(groupNumberParam);
      if (
        groupNumberParam !== null &&
        (!Number.isInteger(groupNumber) || groupNumber < 1 || groupNumber > 30)
      ) {
        sendJson(response, 400, { error: "หมายเลขกลุ่มไม่ถูกต้อง" });
        return;
      }

      const offset = Number(params.get("offset") || 0);
      if (!Number.isSafeInteger(offset) || offset < 0) {
        sendJson(response, 400, { error: "ตำแหน่งรายการไม่ถูกต้อง" });
        return;
      }

      const pageSize = 50;
      let registrationQuery = getAdminClient()
        .from("registrations")
        .select("id, application_code, application_year, title, first_name, last_name, group_number, slot_text, slot_start, slot_end")
        .order("group_number", { ascending: true })
        .order("application_code", { ascending: true });
      if (groupNumber !== null) {
        registrationQuery = registrationQuery.eq("group_number", groupNumber);
      }
      const { data, error } = await registrationQuery.range(offset, offset + pageSize);
      if (error) throw error;

      const registrations = data || [];
      sendJson(response, 200, {
        registrations: registrations.slice(0, pageSize),
        has_more: registrations.length > pageSize,
      });
      return;
    }

    const { data, error } = await getAdminClient().rpc("search_registrations", {
      p_query: query,
      p_limit: 10,
    });
    if (error) throw error;
    sendJson(response, 200, { registrations: data });
  });
}
