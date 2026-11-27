export function formatAcademicYear(applicationYear: string): string {
  const year = Number(applicationYear);
  if (!/^[1-9]\d{3}$/.test(applicationYear) || !Number.isSafeInteger(year)) {
    throw new Error("ปีการศึกษาไม่ถูกต้อง");
  }
  return String(year + 543);
}

export function parseBuddhistAcademicYear(buddhistYear: string): string | null {
  if (!/^[1-9]\d{3}$/.test(buddhistYear)) return null;
  const applicationYear = Number(buddhistYear) - 543;
  return applicationYear >= 1900 && applicationYear <= 9999
    ? String(applicationYear)
    : null;
}
