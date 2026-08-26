/**
 * Turns a schedule trigger into the instants it fires at.
 *
 * Pure: no filesystem, no rule loading. Backfilling missed occurrences is the
 * same question as scheduling the next one, so both go through here.
 */
import { Cron } from "croner";

export interface ScheduleEvery {
  days?: number;
  weeks?: number;
  /** Calendar date the interval counts from. */
  anchor: string;
  /** Local time of day, `HH:MM`. Defaults to midnight. */
  at?: string;
}

export interface ScheduleTrigger {
  type: "schedule";
  cron?: string;
  every?: ScheduleEvery;
  timezone?: string;
}

/** Occurrences returned by a single call, so a stale watermark cannot hang the runtime. */
export const OCCURRENCE_LIMIT = 500;

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** Accepts only dates that survive a round trip, so 2026-02-30 is rejected. */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = CALENDAR_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function isTimeOfDay(value: unknown): value is string {
  return typeof value === "string" && TIME_OF_DAY.test(value);
}

export function isValidCron(pattern: string, timeZone?: string): boolean {
  try {
    const job = new Cron(pattern, { timezone: timeZone, paused: true });
    const runs = job.nextRun() !== null;
    job.stop();
    return runs;
  } catch {
    return false;
  }
}

/**
 * Normalises a raw trigger mapping, returning null when it is not a usable
 * schedule. The validator reports precise diagnostics; this only decides
 * whether the runtime can act on it.
 */
export function parseScheduleTrigger(value: unknown): ScheduleTrigger | null {
  if (!isRecord(value) || value.type !== "schedule") return null;
  const timezone = value.timezone;
  if (timezone !== undefined && typeof timezone !== "string") return null;
  const hasCron = value.cron !== undefined;
  const hasEvery = value.every !== undefined;
  if (hasCron === hasEvery) return null;
  if (hasCron) {
    if (typeof value.cron !== "string" || !isValidCron(value.cron, timezone)) return null;
    return { type: "schedule", cron: value.cron, ...(timezone ? { timezone } : {}) };
  }
  const every = value.every;
  if (!isRecord(every)) return null;
  const hasDays = every.days !== undefined;
  const hasWeeks = every.weeks !== undefined;
  if (hasDays === hasWeeks) return null;
  if (hasDays && !isPositiveInteger(every.days)) return null;
  if (hasWeeks && !isPositiveInteger(every.weeks)) return null;
  if (!isCalendarDate(every.anchor)) return null;
  if (every.at !== undefined && !isTimeOfDay(every.at)) return null;
  return {
    type: "schedule",
    every: {
      ...(hasDays ? { days: every.days as number } : { weeks: every.weeks as number }),
      anchor: every.anchor,
      ...(every.at !== undefined ? { at: every.at as string } : {}),
    },
    ...(timezone ? { timezone } : {}),
  };
}

function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
  );
  return asUtc - instant.getTime();
}

/**
 * Resolves a local wall-clock moment to an instant. Two passes settle the
 * offset, which matters on the days a timezone changes it.
 */
function instantFromLocal(dayNumber: number, minutes: number, timeZone: string): Date {
  const naive = dayNumber * 86_400_000 + minutes * 60_000;
  const firstOffset = zoneOffsetMs(new Date(naive), timeZone);
  const candidate = new Date(naive - firstOffset);
  const secondOffset = zoneOffsetMs(candidate, timeZone);
  return secondOffset === firstOffset ? candidate : new Date(naive - secondOffset);
}

function dayNumberFromCalendarDate(value: string): number {
  const match = CALENDAR_DATE.exec(value)!;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000;
}

function dayNumberFromInstant(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return Date.UTC(value("year"), value("month") - 1, value("day")) / 86_400_000;
}

function minutesFromTimeOfDay(value: string | undefined): number {
  if (value === undefined) return 0;
  const match = TIME_OF_DAY.exec(value)!;
  return Number(match[1]) * 60 + Number(match[2]);
}

function everyOccurrences(
  every: ScheduleEvery,
  after: Date,
  until: Date,
  timeZone: string,
  limit: number,
): Date[] {
  const step = every.days ?? (every.weeks as number) * 7;
  const anchorDay = dayNumberFromCalendarDate(every.anchor);
  const minutes = minutesFromTimeOfDay(every.at);
  // Jump close to the window instead of walking from the anchor, which may be
  // years back, then step back one interval to absorb timezone rounding.
  const elapsed = dayNumberFromInstant(after, timeZone) - anchorDay;
  let index = Math.max(0, Math.floor(elapsed / step) - 1);
  const found: Date[] = [];
  while (found.length < limit) {
    const instant = instantFromLocal(anchorDay + index * step, minutes, timeZone);
    index += 1;
    if (instant.getTime() <= after.getTime()) continue;
    if (instant.getTime() > until.getTime()) break;
    found.push(instant);
  }
  return found;
}

function cronOccurrences(
  pattern: string,
  after: Date,
  until: Date,
  timeZone: string,
  limit: number,
): Date[] {
  const job = new Cron(pattern, { timezone: timeZone, paused: true });
  const found: Date[] = [];
  let cursor = after;
  while (found.length < limit) {
    const next = job.nextRun(cursor);
    if (next === null || next.getTime() > until.getTime()) break;
    found.push(next);
    cursor = next;
  }
  job.stop();
  return found;
}

/**
 * Every occurrence in `(after, until]`, oldest first.
 *
 * The window is half-open at the start so a watermark can be passed straight
 * in: the occurrence already handled is never handed back.
 */
export function occurrencesBetween(
  trigger: ScheduleTrigger,
  after: Date,
  until: Date,
  timeZone: string,
  limit: number = OCCURRENCE_LIMIT,
): Date[] {
  if (after.getTime() >= until.getTime()) return [];
  const zone = trigger.timezone ?? timeZone;
  if (trigger.cron !== undefined) return cronOccurrences(trigger.cron, after, until, zone, limit);
  if (trigger.every !== undefined)
    return everyOccurrences(trigger.every, after, until, zone, limit);
  return [];
}

/** The first occurrence strictly after `after`, used to arm live timers. */
export function nextOccurrenceAfter(
  trigger: ScheduleTrigger,
  after: Date,
  timeZone: string,
): Date | null {
  const zone = trigger.timezone ?? timeZone;
  if (trigger.cron !== undefined) {
    const job = new Cron(trigger.cron, { timezone: zone, paused: true });
    const next = job.nextRun(after);
    job.stop();
    return next;
  }
  if (trigger.every === undefined) return null;
  const [found] = everyOccurrences(
    trigger.every,
    after,
    new Date(after.getTime() + 400 * 86_400_000),
    zone,
    1,
  );
  return found ?? null;
}
