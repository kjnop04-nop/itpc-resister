import { describe, expect, it } from "vitest";
import { isWithinSlot } from "./schedule";

describe("isWithinSlot", () => {
  it("includes the start and excludes the end of a slot", () => {
    expect(isWithinSlot("11:10:00", "11:40:00", 670)).toBe(true);
    expect(isWithinSlot("11:10:00", "11:40:00", 699)).toBe(true);
    expect(isWithinSlot("11:10:00", "11:40:00", 700)).toBe(false);
  });

  it("returns false before the assigned slot", () => {
    expect(isWithinSlot("11:10:00", "11:40:00", 669)).toBe(false);
  });

  it("rejects malformed database time values", () => {
    expect(() => isWithinSlot("11.10", "11:40:00", 670)).toThrow(
      "รูปแบบเวลาไม่ถูกต้อง",
    );
  });
});
