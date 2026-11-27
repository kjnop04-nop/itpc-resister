import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import { writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";

const requiredColumns = [
  "รหัสรับสมัคร",
  "ปีการสมัคร",
  "คำนำหน้า",
  "ชื่อ",
  "นามสกุล",
  "กลุ่มนักเรียน (กิจกรรม)",
  "เวลากลุ่มนักเรียน (กิจกรรม)",
];
function parseSlot(value, rowNumber) {
  const match = value.match(/(\d{1,2})[.:](\d{2})\s*-\s*(\d{1,2})[.:](\d{2})/);
  if (!match) {
    throw new Error(`แถว ${rowNumber}: รูปแบบเวลา "${value}" ไม่ถูกต้อง`);
  }

  const [, startHour, startMinute, endHour, endMinute] = match;
  const start = `${startHour.padStart(2, "0")}:${startMinute}`;
  const end = `${endHour.padStart(2, "0")}:${endMinute}`;
  const startMinutes = Number(startHour) * 60 + Number(startMinute);
  const endMinutes = Number(endHour) * 60 + Number(endMinute);

  if (
    Number(startHour) > 23 ||
    Number(startMinute) > 59 ||
    Number(endHour) > 23 ||
    Number(endMinute) > 59 ||
    startMinutes >= endMinutes
  ) {
    throw new Error(`แถว ${rowNumber}: ช่วงเวลา "${value}" ไม่ถูกต้อง`);
  }

  return { start, end };
}

function requiredValue(row, columnName, rowNumber) {
  const value = String(row[columnName] ?? "").trim();
  if (!value) {
    throw new Error(`แถว ${rowNumber}: ไม่มีข้อมูล "${columnName}"`);
  }
  return value;
}

async function main() {
  const mode = process.argv[2];
  const dryRun = mode === "--dry-run";
  const exportCsv = mode === "--export-csv";
  const inputPath = dryRun || exportCsv ? process.argv[3] : mode;
  if (!inputPath) {
    throw new Error("วิธีใช้: npm run import:registrations -- [--dry-run|--export-csv] <path-to-xlsx>");
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(resolve(inputPath));
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error("ไม่พบ worksheet ในไฟล์ Excel");
  }

  const headers = worksheet.getRow(1).values.slice(1).map((cell) => String(cell ?? "").trim());
  const missingColumns = requiredColumns.filter((column) => !headers.includes(column));
  if (missingColumns.length) {
    throw new Error(`ไม่พบคอลัมน์ที่จำเป็น: ${missingColumns.join(", ")}`);
  }
  const hasNickname = headers.includes("ชื่อเล่น");
  const hasParentPhone = headers.includes("เบอร์ผู้ปกครอง");

  const rows = [];
  const seenCodes = new Set();
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const source = Object.fromEntries(
      headers.map((header, index) => [header, String(row.getCell(index + 1).text ?? "").trim()]),
    );
    if (!requiredColumns.some((column) => source[column])) return;

    const applicationCode = requiredValue(source, "รหัสรับสมัคร", rowNumber).toUpperCase();
    if (!/^[A-Z0-9]+$/.test(applicationCode)) {
      throw new Error(`แถว ${rowNumber}: รหัสรับสมัครมีอักขระที่ไม่รองรับ`);
    }
    if (seenCodes.has(applicationCode)) {
      throw new Error(`พบรหัสรับสมัครซ้ำในไฟล์ (แถว ${rowNumber})`);
    }
    seenCodes.add(applicationCode);

    const groupNumber = Number(requiredValue(source, "กลุ่มนักเรียน (กิจกรรม)", rowNumber));
    if (!Number.isInteger(groupNumber) || groupNumber < 1 || groupNumber > 30) {
      throw new Error(`แถว ${rowNumber}: หมายเลขกลุ่มไม่ถูกต้อง`);
    }
    const slotText = requiredValue(source, "เวลากลุ่มนักเรียน (กิจกรรม)", rowNumber);
    const slot = parseSlot(slotText, rowNumber);
    if (hasNickname && source["ชื่อเล่น"].length > 100) {
      throw new Error(`แถว ${rowNumber}: ชื่อเล่นยาวเกิน 100 ตัวอักษร`);
    }
    if (hasParentPhone && source["เบอร์ผู้ปกครอง"].length > 32) {
      throw new Error(`แถว ${rowNumber}: เบอร์ผู้ปกครองยาวเกิน 32 ตัวอักษร`);
    }

    rows.push({
      application_code: applicationCode,
      application_year: requiredValue(source, "ปีการสมัคร", rowNumber),
      title: requiredValue(source, "คำนำหน้า", rowNumber),
      first_name: requiredValue(source, "ชื่อ", rowNumber),
      last_name: requiredValue(source, "นามสกุล", rowNumber),
      group_number: groupNumber,
      slot_text: slotText,
      slot_start: slot.start,
      slot_end: slot.end,
      ...(hasNickname ? { nickname: source["ชื่อเล่น"] } : {}),
      ...(hasParentPhone ? { parent_phone: source["เบอร์ผู้ปกครอง"] } : {}),
    });
  });

  if (!rows.length) {
    throw new Error("ไม่พบข้อมูลผู้สมัครใน worksheet");
  }

  const applicationYears = new Set(rows.map(({ application_year }) => application_year));
  if (applicationYears.size !== 1 || !/^[1-9]\d{3}$/.test(rows[0].application_year)) {
    throw new Error("ไฟล์นำเข้าต้องมีปีการศึกษา ค.ศ. 4 หลักเพียงปีเดียว");
  }

  if (dryRun) {
    console.log(`ตรวจสอบไฟล์ Excel เรียบร้อย: ${rows.length} รายการ`);
    return;
  }

  if (exportCsv) {
    const sourcePath = resolve(inputPath);
    const outputPath = process.argv[4]
      ? resolve(process.argv[4])
      : join(
          dirname(sourcePath),
          `${basename(sourcePath, extname(sourcePath))}_supabase.csv`,
        );
    const columns = [
      "application_code",
      "application_year",
      "title",
      "first_name",
      "last_name",
      "group_number",
      "slot_text",
      "slot_start",
      "slot_end",
      ...(hasNickname ? ["nickname"] : []),
      ...(hasParentPhone ? ["parent_phone"] : []),
    ];
    const csvValue = (value) => `"${String(value).replaceAll('"', '""')}"`;
    const csv = [
      columns.map(csvValue).join(","),
      ...rows.map((row) => columns.map((column) => csvValue(row[column])).join(",")),
    ].join("\r\n");

    await writeFile(outputPath, `${csv}\r\n`, { encoding: "utf8", flag: "wx" });
    console.log(`สร้างไฟล์ CSV สำหรับ Supabase เรียบร้อย: ${outputPath} (${rows.length} รายการ)`);
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("ต้องกำหนด SUPABASE_URL และ SUPABASE_ANON_KEY ใน environment");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const applicationYear = rows[0].application_year;
  const { data: yearSettings, error: settingsError } = await supabase
    .from("academic_year_settings")
    .select("schedule")
    .eq("application_year", applicationYear)
    .eq("is_active", true)
    .single();
  if (settingsError) {
    throw new Error(`ไม่พบการตั้งค่าปีการศึกษาที่กำลังใช้งาน: ${settingsError.message}`);
  }
  const scheduledRows = rows.map((row) => {
    const round = yearSettings.schedule[Math.floor((row.group_number - 1) / 6)];
    const activityStart = round.activity_start;
    const activityEnd = round.activity_end;
    return {
      ...row,
      slot_text: `${activityStart.replace(":", ".")} - ${activityEnd.replace(":", ".")} น.`,
      slot_start: activityStart,
      slot_end: activityEnd,
    };
  });
  for (let offset = 0; offset < scheduledRows.length; offset += 200) {
    const { error } = await supabase
      .from("registrations")
      .upsert(scheduledRows.slice(offset, offset + 200), {
        onConflict: "application_year,application_code",
      });
    if (error) {
      throw new Error(`นำเข้าข้อมูลไม่สำเร็จ: ${error.message}`);
    }
  }

  console.log(`นำเข้าข้อมูลผู้สมัคร ${rows.length} รายการเรียบร้อย`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
