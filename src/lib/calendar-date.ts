const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(value: number) {
  return String(value).padStart(2, "0");
}

export function dateFromCalendarDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const match = CALENDAR_DATE.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day)
    return undefined;
  return date;
}

export function dateToCalendarDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function calendarDateAtOffset(now: Date, offsetDays: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const date = new Date(Date.UTC(value("year"), value("month") - 1, value("day") + offsetDays));
  return date.toISOString().slice(0, 10);
}
