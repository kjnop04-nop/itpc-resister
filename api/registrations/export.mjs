import { sendJson, withAuthenticatedStaff } from "../_lib/server.mjs";

const PAGE_SIZE = 1000;
const COLUMNS = [
  "application_code",
  "application_year",
  "title",
  "first_name",
  "last_name",
  "group_number",
  "slot_text",
  "slot_start",
  "slot_end",
];

function csvValue(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed" }, { Allow: "GET" });
    return;
  }

  await withAuthenticatedStaff(request, response, async (staff, client) => {
    if (staff.role !== "admin" && staff.role !== "superadmin") {
      sendJson(response, 403, { error: "เฉพาะแอดมินเท่านั้นที่ส่งออกข้อมูลนักเรียนได้" });
      return;
    }

    const applicationYear = new URL(request.url, "http://localhost").searchParams.get("application_year") || "";
    if (!/^[1-9]\d{3}$/.test(applicationYear)) {
      sendJson(response, 400, { error: "กรุณาเลือกปีการศึกษาให้ถูกต้อง" });
      return;
    }

    const rows = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await client
        .from("registrations")
        .select(COLUMNS.join(", "))
        .eq("application_year", applicationYear)
        .order("application_code", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      rows.push(...data);
      if (data.length < PAGE_SIZE) break;
    }

    const csv = [
      COLUMNS.map(csvValue).join(","),
      ...rows.map((row) => COLUMNS.map((column) => csvValue(row[column])).join(",")),
    ].join("\r\n");
    response.statusCode = 200;
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", `attachment; filename="students-${applicationYear}.csv"`);
    response.setHeader("Cache-Control", "no-store");
    response.end(`\uFEFF${csv}\r\n`);
  });
}
