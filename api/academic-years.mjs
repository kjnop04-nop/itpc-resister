import { getAdminClient, readJson, sendJson, withAuthenticatedStaff } from "./_lib/server.mjs";

const YEAR_PATTERN = /^[1-9][0-9]{3}$/;
const SCHEDULE_FIELDS = [
  "registration_start",
  "registration_end",
  "activity_start",
  "activity_end",
];

function timeInMinutes(value) {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    return null;
  }
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function validateSchedule(schedule) {
  if (!Array.isArray(schedule) || schedule.length !== 5) {
    return "ตารางเวลาต้องมีครบ 5 รอบ";
  }

  let previousActivityEnd = -1;
  for (let index = 0; index < schedule.length; index += 1) {
    const round = schedule[index];
    if (!round || typeof round !== "object" || Array.isArray(round)) {
      return `รอบที่ ${index + 1}: รูปแบบข้อมูลไม่ถูกต้อง`;
    }
    const times = SCHEDULE_FIELDS.map((field) => timeInMinutes(round[field]));
    if (times.some((time) => time === null)) {
      return `รอบที่ ${index + 1}: กรุณากรอกเวลาในรูปแบบ HH:MM`;
    }
    const [registrationStart, registrationEnd, activityStart, activityEnd] = times;
    if (
      registrationStart >= registrationEnd ||
      registrationEnd > activityStart ||
      activityStart >= activityEnd ||
      previousActivityEnd > registrationStart
    ) {
      return `รอบที่ ${index + 1}: เวลาต้องเรียงต่อกันและไม่ทับซ้อน`;
    }
    previousActivityEnd = activityEnd;
  }
  return null;
}

export default async function handler(request, response) {
  if (!["GET", "PUT"].includes(request.method)) {
    sendJson(response, 405, { error: "Method not allowed" }, { Allow: "GET, PUT" });
    return;
  }

  await withAuthenticatedStaff(request, response, async (staff) => {
    const client = getAdminClient();
    if (request.method === "GET") {
      const { data, error } = await client
        .from("academic_year_settings")
        .select("application_year, is_active, schedule")
        .order("application_year", { ascending: false });
      if (error) throw error;
      const activeYear = data.find(({ is_active }) => is_active)?.application_year;
      if (!activeYear) throw new Error("ยังไม่ได้กำหนดปีการศึกษาที่ใช้งาน");
      sendJson(response, 200, { years: data, active_year: activeYear });
      return;
    }

    if (staff.role !== "admin" && staff.role !== "superadmin") {
      sendJson(response, 403, { error: "เฉพาะแอดมินเท่านั้นที่ตั้งค่าปีการศึกษาได้" });
      return;
    }

    let body;
    try {
      body = await readJson(request);
    } catch {
      sendJson(response, 400, { error: "ข้อมูลคำขอไม่ถูกต้อง" });
      return;
    }
    const applicationYear = body?.application_year;
    if (typeof applicationYear !== "string" || !YEAR_PATTERN.test(applicationYear)) {
      sendJson(response, 400, { error: "ปีการศึกษา (ค.ศ.) ต้องเป็นตัวเลข 4 หลัก" });
      return;
    }
    const scheduleError = validateSchedule(body?.schedule);
    if (scheduleError) {
      sendJson(response, 400, { error: scheduleError });
      return;
    }
    if (typeof body.activate !== "boolean") {
      sendJson(response, 400, { error: "สถานะปีการศึกษาไม่ถูกต้อง" });
      return;
    }

    const { error } = await client.rpc("save_academic_year_settings", {
      p_application_year: applicationYear,
      p_schedule: body.schedule,
      p_activate: body.activate,
    });
    if (error?.code === "22023") {
      sendJson(response, 400, { error: "ปีการศึกษาหรือตารางเวลาไม่ถูกต้อง" });
      return;
    }
    if (error) throw error;
    sendJson(response, 200, { success: true });
  });
}
