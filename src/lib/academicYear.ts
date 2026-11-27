export function formatAcademicYear(applicationYear: string): string {
  const year = Number(applicationYear);
  if (!/^[1-9]\d{3}$/.test(applicationYear) || !Number.isSafeInteger(year)) {
    throw new Error("ปีการศึกษาไม่ถูกต้อง");
  }
  return String(year + 543);
}
