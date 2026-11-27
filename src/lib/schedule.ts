export type GroupSchedule = {
  registrationTime: string;
  activityTime: string;
};

export type ScheduleRound = {
  registration_start: string;
  registration_end: string;
  activity_start: string;
  activity_end: string;
};

export const DEFAULT_SCHEDULE: readonly ScheduleRound[] = [
  { registration_start: "08:00", registration_end: "08:20", activity_start: "08:30", activity_end: "09:00" },
  { registration_start: "08:40", registration_end: "09:00", activity_start: "09:10", activity_end: "09:40" },
  { registration_start: "09:20", registration_end: "09:40", activity_start: "09:50", activity_end: "10:20" },
  { registration_start: "10:00", registration_end: "10:20", activity_start: "10:30", activity_end: "11:00" },
  { registration_start: "10:40", registration_end: "11:00", activity_start: "11:10", activity_end: "11:40" },
];

function displayTime(value: string) {
  return value.replace(":", ".");
}

export function getGroupSchedule(
  groupNumber: number,
  schedules: readonly ScheduleRound[] = DEFAULT_SCHEDULE,
): GroupSchedule {
  if (!Number.isInteger(groupNumber) || groupNumber < 1 || groupNumber > 30) {
    throw new Error(`หมายเลขกลุ่มไม่ถูกต้อง: ${groupNumber}`);
  }
  const round = schedules[Math.floor((groupNumber - 1) / 6)];
  if (!round) throw new Error("ไม่พบตารางเวลาของรอบนี้");
  return {
    registrationTime: `${displayTime(round.registration_start)} - ${displayTime(round.registration_end)} น.`,
    activityTime: `${displayTime(round.activity_start)} - ${displayTime(round.activity_end)} น.`,
  };
}

function toMinutes(value: string): number {
  const match = value.match(/^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/);
  if (!match) {
    throw new Error(`รูปแบบเวลาไม่ถูกต้อง: ${value}`);
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    throw new Error(`เวลาอยู่นอกช่วงที่ถูกต้อง: ${value}`);
  }

  return hours * 60 + minutes;
}

export function isWithinSlot(
  start: string,
  end: string,
  currentMinutes: number,
): boolean {
  return currentMinutes >= toMinutes(start) && currentMinutes < toMinutes(end);
}

export function currentBangkokMinutes(date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return hour * 60 + minute;
}
