import { getAdminClient, sendJson, withAuthenticatedStaff } from "./_lib/server.mjs";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed" }, { Allow: "GET" });
    return;
  }

  await withAuthenticatedStaff(request, response, async () => {
    const code = new URL(request.url, "http://localhost")
      .searchParams.get("code")
      ?.replace(/[^a-z0-9]/gi, "")
      .toUpperCase();
    if (!code || code.length < 3 || code.length > 30) {
      sendJson(response, 400, { error: "กรุณากรอกรหัสรับสมัครอย่างน้อย 3 ตัวอักษร" });
      return;
    }

    const { data, error } = await getAdminClient()
      .from("registrations")
      .select("id, application_code, application_year, title, first_name, last_name, group_number, slot_text, slot_start, slot_end")
      .ilike("application_code", `%${code}%`)
      .order("application_code")
      .limit(10);
    if (error) throw error;
    sendJson(response, 200, { registrations: data });
  });
}
