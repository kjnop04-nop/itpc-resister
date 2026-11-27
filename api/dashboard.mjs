import { sendJson, withAuthenticatedStaff } from "./_lib/server.mjs";

const GROUP_COUNT = 30;
const PAGE_SIZE = 1000;

export default async function handler(request, response) {
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed" }, { Allow: "GET" });
    return;
  }

  await withAuthenticatedStaff(request, response, async (_staff, client) => {
    const applicationYear = new URL(request.url, "http://localhost").searchParams.get("application_year") || "";
    if (!/^[1-9]\d{3}$/.test(applicationYear)) {
      sendJson(response, 400, { error: "กรุณาเลือกปีการศึกษาให้ถูกต้อง" });
      return;
    }
    const groups = Array.from({ length: GROUP_COUNT }, (_, index) => ({
      group_number: index + 1,
      total: 0,
      checked_in: 0,
    }));
    const groupsByNumber = new Map(groups.map((group) => [group.group_number, group]));
    const groupByRegistrationId = new Map();

    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await client
        .from("itpc_register_registrations")
        .select("id, group_number")
        .eq("application_year", applicationYear)
        .order("id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;

      for (const registration of data) {
        const group = groupsByNumber.get(registration.group_number);
        if (!group) throw new Error("พบหมายเลขกลุ่มผู้สมัครที่ไม่ถูกต้อง");
        group.total += 1;
        groupByRegistrationId.set(registration.id, registration.group_number);
      }

      if (data.length < PAGE_SIZE) break;
    }

    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await client
        .from("itpc_register_checkins")
        .select("id, registration_id, itpc_register_registrations!inner(application_year)")
        .eq("itpc_register_registrations.application_year", applicationYear)
        .is("voided_at", null)
        .order("id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;

      for (const checkin of data) {
        const groupNumber = groupByRegistrationId.get(checkin.registration_id);
        if (groupNumber === undefined) {
          throw new Error("พบรายการลงทะเบียนที่ไม่มีข้อมูลผู้สมัคร");
        }
        groupsByNumber.get(groupNumber).checked_in += 1;
      }

      if (data.length < PAGE_SIZE) break;
    }

    const summary = groups.reduce(
      (totals, group) => ({
        total: totals.total + group.total,
        checked_in: totals.checked_in + group.checked_in,
      }),
      { total: 0, checked_in: 0 },
    );
    sendJson(response, 200, { summary: { ...summary, groups } });
  });
}
