import { describe, expect, it } from "vitest";
import { formatAcademicYear } from "./academicYear";

describe("formatAcademicYear", () => {
  it("displays Gregorian application years as Buddhist academic years", () => {
    expect(formatAcademicYear("2027")).toBe("2570");
    expect(formatAcademicYear("2127")).toBe("2670");
  });

  it("rejects malformed years", () => {
    expect(() => formatAcademicYear("27")).toThrow("ปีการศึกษาไม่ถูกต้อง");
  });
});
