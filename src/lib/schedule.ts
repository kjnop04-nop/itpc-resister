export type GroupSchedule = {
  registrationTime: string;
  activityTime: string;
};

const GROUP_SCHEDULES: readonly GroupSchedule[] = [
  { registrationTime: "08.00 - 08.20 น.", activityTime: "08.30 - 09.00 น." },
  { registrationTime: "08.40 - 09.00 น.", activityTime: "09.10 - 09.40 น." },
  { registrationTime: "09.20 - 09.40 น.", activityTime: "09.50 - 10.20 น." },
  { registrationTime: "10.00 - 10.20 น.", activityTime: "10.30 - 11.00 น." },
  { registrationTime: "10.40 - 11.00 น.", activityTime: "11.10 - 11.40 น." },
];

export function getGroupSchedule(groupNumber: number): GroupSchedule {
  if (!Number.isInteger(groupNumber) || groupNumber < 1 || groupNumber > 30) {
    throw new Error(`หมายเลขกลุ่มไม่ถูกต้อง: ${groupNumber}`);
  }
  return GROUP_SCHEDULES[Math.floor((groupNumber - 1) / 6)];
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
