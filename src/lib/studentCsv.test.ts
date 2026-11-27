import { describe, expect, it } from "vitest";
import { parseStudentCsv } from "./studentCsv";

const headers =
  "application_code,application_year,title,first_name,last_name,group_number,slot_text,slot_start,slot_end";

describe("parseStudentCsv", () => {
  it("parses UTF-8 CSV values including quoted commas and escaped quotes", () => {
    const result = parseStudentCsv(
      `\uFEFF${headers}\r\nAB001,2027,เด็กชาย,"ชื่อ, ทดสอบ",นามสกุล,3,"09.50 - 10.20 น.",09:50:00,10:20:00`,
    );

    expect(result).toEqual([{
      application_code: "AB001",
      application_year: "2027",
      title: "เด็กชาย",
      first_name: "ชื่อ, ทดสอบ",
      last_name: "นามสกุล",
      group_number: 3,
      slot_text: "09.50 - 10.20 น.",
      slot_start: "09:50:00",
      slot_end: "10:20:00",
    }]);
  });

  it("reports missing columns and malformed rows", () => {
    expect(() => parseStudentCsv("application_code,first_name\nA1,สมชาย")).toThrow(
      "ไม่พบคอลัมน์ที่จำเป็น",
    );
    expect(() => parseStudentCsv(    `${headers}\nA1,2027,เด็กชาย,สมชาย,ทดสอบ,1`)).toThrow(
      "จำนวนข้อมูลไม่ตรงกับหัวคอลัมน์",
    );
  });

  it("supports quoted line breaks and rejects unclosed quotes", () => {
    const result = parseStudentCsv(
      `${headers}\nAB001,2027,เด็กชาย,"ชื่อ\nทดสอบ",นามสกุล,3,เวลา,09:00,09:30`,
    );
    expect(result[0].first_name).toBe("ชื่อ\nทดสอบ");
    expect(() => parseStudentCsv(    `${headers}\n"A1,2027`)).toThrow(
      "เครื่องหมายคำพูดที่ไม่ปิด",
    );
  });

  it("rejects duplicate application codes regardless of letter case", () => {
    expect(() => parseStudentCsv(
      `${headers}\nAB001,2027,เด็กชาย,สมชาย,ทดสอบ,1,เวลา,09:00,09:30\nab001,2027,เด็กชาย,สมชาย,ทดสอบ,1,เวลา,09:00,09:30`,
    )).toThrow("พบรหัสรับสมัครซ้ำในไฟล์");
  });
});
