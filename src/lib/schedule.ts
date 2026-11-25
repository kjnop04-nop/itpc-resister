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
