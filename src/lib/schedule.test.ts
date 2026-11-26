import { describe, expect, it } from "vitest";
import { getGroupSchedule, isWithinSlot } from "./schedule";

describe("getGroupSchedule", () => {
  it("maps each group range to its registration and activity times", () => {
    expect([1, 7, 13, 19, 25].map(getGroupSchedule)).toEqual([
      { registrationTime: "08.00 - 08.20 น.", activityTime: "08.30 - 09.00 น." },
      { registrationTime: "08.40 - 09.00 น.", activityTime: "09.10 - 09.40 น." },
      { registrationTime: "09.20 - 09.40 น.", activityTime: "09.50 - 10.20 น." },
      { registrationTime: "10.00 - 10.20 น.", activityTime: "10.30 - 11.00 น." },
      { registrationTime: "10.40 - 11.00 น.", activityTime: "11.10 - 11.40 น." },
    ]);
  });

  it("rejects group numbers outside the schedule", () => {
    expect(() => getGroupSchedule(31)).toThrow("หมายเลขกลุ่มไม่ถูกต้อง");
  });
});

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
