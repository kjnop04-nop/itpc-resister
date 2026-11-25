import { getAdminClient, sendJson, withAuthenticatedStaff } from "./_lib/server.mjs";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed" }, { Allow: "GET" });
    return;
  }

  await withAuthenticatedStaff(request, response, async () => {
    const query = new URL(request.url, "http://localhost")
      .searchParams.get("q")
      ?.trim();
    if (!query || query.length > 100) {
      sendJson(response, 400, { error: "กรุณากรอกคำค้นหาไม่เกิน 100 ตัวอักษร" });
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
