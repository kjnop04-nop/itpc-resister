export type StudentImportRow = {
  application_code: string;
  application_year: string;
  title: string;
  first_name: string;
  last_name: string;
  group_number: number;
  slot_text: string;
  slot_start: string;
  slot_end: string;
};

const columns: (keyof StudentImportRow)[] = [
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

function parseRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (closedQuote && character !== "," && character !== "\r" && character !== "\n") {
      throw new Error("ไฟล์ CSV มีรูปแบบเครื่องหมายคำพูดไม่ถูกต้อง");
    }
    if (character === '"' && field.length === 0 && !closedQuote) {
      quoted = true;
    } else if (character === ",") {
      record.push(field);
      field = "";
      closedQuote = false;
    } else if (character === "\r" || character === "\n") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      record.push(field);
      if (record.some((value) => value.trim() !== "")) records.push(record);
      record = [];
      field = "";
      closedQuote = false;
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("ไฟล์ CSV มีเครื่องหมายคำพูดที่ไม่ปิด");
  if (field !== "" || record.length > 0) {
    record.push(field);
    if (record.some((value) => value.trim() !== "")) records.push(record);
  }
  return records;
}

export function parseStudentCsv(text: string): StudentImportRow[] {
  const records = parseRecords(text.replace(/^\uFEFF/, ""));
  const header = records.shift()?.map((value) => value.trim());
  if (!header?.length) throw new Error("ไม่พบหัวคอลัมน์ในไฟล์ CSV");

  const duplicate = header.find((column, index) => header.indexOf(column) !== index);
  if (duplicate) throw new Error(`พบหัวคอลัมน์ "${duplicate}" ซ้ำ`);
  const missing = columns.filter((column) => !header.includes(column));
  if (missing.length) throw new Error(`ไม่พบคอลัมน์ที่จำเป็น: ${missing.join(", ")}`);
  const positions = columns.map((column) => header.indexOf(column));
  const seenCodes = new Set<string>();

  return records.map((record, rowIndex) => {
    if (record.length !== header.length) {
      throw new Error(`แถว ${rowIndex + 2}: จำนวนข้อมูลไม่ตรงกับหัวคอลัมน์`);
    }
    const values = positions.map((position) => record[position].trim());
    const groupNumber = Number(values[5]);
    if (!Number.isInteger(groupNumber)) {
      throw new Error(`แถว ${rowIndex + 2}: หมายเลขกลุ่มไม่ถูกต้อง`);
    }
    const applicationCode = values[0].toUpperCase();
    if (seenCodes.has(applicationCode)) {
      throw new Error(`พบรหัสรับสมัครซ้ำในไฟล์ (แถว ${rowIndex + 2})`);
    }
    seenCodes.add(applicationCode);
    return {
      application_code: applicationCode,
      application_year: values[1],
      title: values[2],
      first_name: values[3],
      last_name: values[4],
      group_number: groupNumber,
      slot_text: values[6],
      slot_start: values[7],
      slot_end: values[8],
    };
  });
}
