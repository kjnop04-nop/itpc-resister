import { describe, expect, it } from "vitest";
import { formatAcademicYear, parseBuddhistAcademicYear } from "./academicYear";

describe("formatAcademicYear", () => {
  it("displays Gregorian application years as Buddhist academic years", () => {
    expect(formatAcademicYear("2027")).toBe("2570");
    expect(formatAcademicYear("2127")).toBe("2670");
  });

  it("rejects malformed years", () => {
    expect(() => formatAcademicYear("27")).toThrow("ปีการศึกษาไม่ถูกต้อง");
  });
});

describe("parseBuddhistAcademicYear", () => {
  it("converts Buddhist academic years to Gregorian application years", () => {
    expect(parseBuddhistAcademicYear("2571")).toBe("2028");
  });

  it("rejects malformed or out-of-range years", () => {
    expect(parseBuddhistAcademicYear("27")).toBeNull();
    expect(parseBuddhistAcademicYear("2028")).toBeNull();
  });
});
