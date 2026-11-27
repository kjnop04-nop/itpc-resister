import { readJson, sendJson, withAuthenticatedStaff } from "../_lib/server.mjs";

const MAX_IMPORT_ROWS = 500;
const YEAR_PATTERN = /^[1-9]\d{3}$/;
const MAX_LENGTHS = {
  application_code: 64,
  application_year: 32,
  title: 40,
  first_name: 100,
  last_name: 100,
  slot_text: 80,
};
const OPTIONAL_MAX_LENGTHS = {
  nickname: 100,
  parent_phone: 32,
};

function timeInSeconds(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const [, hour, minute, second = "0"] = match;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
  return Number(hour) * 3600 + Number(minute) * 60 + Number(second);
}

function validateRow(row, index) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return `แถว ${index + 1}: รูปแบบข้อมูลไม่ถูกต้อง`;
  }
  for (const [field, maxLength] of Object.entries(MAX_LENGTHS)) {
    if (typeof row[field] !== "string" || !row[field].trim() || row[field].length > maxLength) {
      return `แถว ${index + 1}: ข้อมูล ${field} ไม่ถูกต้อง`;
    }
  }
  for (const [field, maxLength] of Object.entries(OPTIONAL_MAX_LENGTHS)) {
    if (
      Object.prototype.hasOwnProperty.call(row, field) &&
      (typeof row[field] !== "string" || row[field].length > maxLength)
    ) {
      return `แถว ${index + 1}: ข้อมูล ${field} ไม่ถูกต้อง`;
    }
  }
  if (!/^[A-Z0-9]+$/.test(row.application_code)) {
    return `แถว ${index + 1}: รหัสรับสมัครต้องเป็นตัวอักษร A-Z หรือตัวเลข`;
  }
  if (!Number.isInteger(row.group_number) || row.group_number < 1 || row.group_number > 30) {
    return `แถว ${index + 1}: หมายเลขกลุ่มต้องอยู่ระหว่าง 1 ถึง 30`;
  }
  const slotStart = timeInSeconds(row.slot_start);
  const slotEnd = timeInSeconds(row.slot_end);
  if (slotStart === null || slotEnd === null || slotStart >= slotEnd) {
    return `แถว ${index + 1}: ช่วงเวลาไม่ถูกต้อง`;
  }
  return null;
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Method not allowed" }, { Allow: "POST" });
    return;
  }

  await withAuthenticatedStaff(request, response, async (staff, client) => {
    if (staff.role !== "admin" && staff.role !== "superadmin") {
      sendJson(response, 403, { error: "เฉพาะแอดมินเท่านั้นที่นำเข้าข้อมูลนักเรียนได้" });
      return;
    }

    let body;
    try {
      body = await readJson(request);
    } catch {
      sendJson(response, 400, { error: "ข้อมูลคำขอไม่ถูกต้อง" });
      return;
    }
    if (!Array.isArray(body?.rows) || body.rows.length === 0 || body.rows.length > MAX_IMPORT_ROWS) {
      sendJson(response, 400, { error: `กรุณาส่งข้อมูล 1 ถึง ${MAX_IMPORT_ROWS} รายการต่อครั้ง` });
      return;
    }

    const importYear = body.rows[0]?.application_year;
    if (typeof importYear !== "string" || !YEAR_PATTERN.test(importYear)) {
      sendJson(response, 400, { error: "ปีการศึกษา (ค.ศ.) ต้องเป็นตัวเลข 4 หลัก" });
      return;
    }
    const { data: activeYear, error: activeYearError } = await client
      .from("academic_year_settings")
      .select("application_year, schedule")
      .eq("is_active", true)
      .single();
    if (activeYearError) throw activeYearError;
    if (importYear !== activeYear.application_year) {
      sendJson(response, 409, { error: "นำเข้าได้เฉพาะปีการศึกษาที่กำลังใช้งาน" });
      return;
    }

    const seenCodes = new Set();
    const hasNickname = Object.prototype.hasOwnProperty.call(body.rows[0], "nickname");
    const hasParentPhone = Object.prototype.hasOwnProperty.call(body.rows[0], "parent_phone");
    const rows = [];
    for (let index = 0; index < body.rows.length; index += 1) {
      const row = body.rows[index];
      if (row?.application_year !== importYear) {
        sendJson(response, 400, { error: `แถว ${index + 1}: ในไฟล์ต้องเป็นปีการศึกษาเดียวกันทั้งหมด` });
        return;
      }
      const validationError = validateRow(row, index);
      if (validationError) {
        sendJson(response, 400, { error: validationError });
        return;
      }
      if (
        Object.prototype.hasOwnProperty.call(row, "nickname") !== hasNickname ||
        Object.prototype.hasOwnProperty.call(row, "parent_phone") !== hasParentPhone
      ) {
        sendJson(response, 400, { error: `แถว ${index + 1}: คอลัมน์ชื่อเล่นและเบอร์ผู้ปกครองต้องมีครบทุกแถว` });
        return;
      }
      if (seenCodes.has(row.application_code)) {
        sendJson(response, 400, { error: `พบรหัสรับสมัครซ้ำในชุดข้อมูล: ${row.application_code}` });
        return;
      }
      seenCodes.add(row.application_code);
      const round = activeYear.schedule[Math.floor((row.group_number - 1) / 6)];
      const activityStart = round.activity_start;
      const activityEnd = round.activity_end;
      rows.push({
        application_code: row.application_code,
        application_year: row.application_year.trim(),
        title: row.title.trim(),
        first_name: row.first_name.trim(),
        last_name: row.last_name.trim(),
        group_number: row.group_number,
        slot_text: `${activityStart.replace(":", ".")} - ${activityEnd.replace(":", ".")} น.`,
        slot_start: activityStart,
        slot_end: activityEnd,
        ...(hasNickname ? { nickname: row.nickname.trim() || null } : {}),
        ...(hasParentPhone ? { parent_phone: row.parent_phone.trim() || null } : {}),
      });
    }

    const { error } = await client
      .from("registrations")
      .upsert(rows, { onConflict: "application_year,application_code" });
    if (error) throw error;
    sendJson(response, 200, { imported: rows.length });
  });
}
