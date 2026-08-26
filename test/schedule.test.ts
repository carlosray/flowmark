import assert from "node:assert/strict";
import test from "node:test";

import {
  nextOccurrenceAfter,
  occurrencesBetween,
  parseScheduleTrigger,
} from "../src/lib/workspace/schedule.ts";

const isoDates = (dates: Date[]) => dates.map((date) => date.toISOString());
const calendarDates = (dates: Date[]) => dates.map((date) => date.toISOString().slice(0, 10));

test("cron occurrences follow the pattern", () => {
  const trigger = { type: "schedule" as const, cron: "0 8 * * 2,4" };
  assert.deepEqual(
    isoDates(
      occurrencesBetween(
        trigger,
        new Date("2026-08-24T00:00:00Z"),
        new Date("2026-09-01T00:00:00Z"),
        "UTC",
      ),
    ),
    ["2026-08-25T08:00:00.000Z", "2026-08-27T08:00:00.000Z"],
  );
});

test("the window excludes its start and includes its end", () => {
  const trigger = { type: "schedule" as const, cron: "0 8 * * *" };
  const found = occurrencesBetween(
    trigger,
    new Date("2026-08-24T08:00:00Z"),
    new Date("2026-08-26T08:00:00Z"),
    "UTC",
  );
  assert.deepEqual(isoDates(found), ["2026-08-25T08:00:00.000Z", "2026-08-26T08:00:00.000Z"]);
});

test("every-days keeps a constant interval across a month boundary", () => {
  const trigger = {
    type: "schedule" as const,
    every: { days: 3, anchor: "2026-08-19", at: "08:00" },
  };
  assert.deepEqual(
    calendarDates(
      occurrencesBetween(
        trigger,
        new Date("2026-08-19T08:00:00Z"),
        new Date("2026-09-05T00:00:00Z"),
        "UTC",
      ),
    ),
    ["2026-08-22", "2026-08-25", "2026-08-28", "2026-08-31", "2026-09-03"],
  );
});

test("a cron every-third-day pattern would have collapsed at the same boundary", () => {
  // Documents why `every` exists: */3 restarts on the first of each month.
  const cron = { type: "schedule" as const, cron: "0 8 */3 * *" };
  const found = calendarDates(
    occurrencesBetween(
      cron,
      new Date("2026-08-27T00:00:00Z"),
      new Date("2026-09-02T00:00:00Z"),
      "UTC",
    ),
  );
  assert.deepEqual(found, ["2026-08-28", "2026-08-31", "2026-09-01"]);
});

test("every-weeks steps by seven days", () => {
  const trigger = {
    type: "schedule" as const,
    every: { weeks: 2, anchor: "2026-08-19", at: "09:30" },
  };
  assert.deepEqual(
    calendarDates(
      occurrencesBetween(
        trigger,
        new Date("2026-08-18T00:00:00Z"),
        new Date("2026-10-01T00:00:00Z"),
        "UTC",
      ),
    ),
    ["2026-08-19", "2026-09-02", "2026-09-16", "2026-09-30"],
  );
});

test("every honours the configured time of day", () => {
  const trigger = {
    type: "schedule" as const,
    every: { days: 1, anchor: "2026-08-19", at: "09:30" },
  };
  const found = occurrencesBetween(
    trigger,
    new Date("2026-08-19T00:00:00Z"),
    new Date("2026-08-20T00:00:00Z"),
    "UTC",
  );
  assert.deepEqual(isoDates(found), ["2026-08-19T09:30:00.000Z"]);
});

test("every defaults to midnight when no time is given", () => {
  const trigger = { type: "schedule" as const, every: { days: 1, anchor: "2026-08-19" } };
  const found = occurrencesBetween(
    trigger,
    new Date("2026-08-18T23:00:00Z"),
    new Date("2026-08-19T12:00:00Z"),
    "UTC",
  );
  assert.deepEqual(isoDates(found), ["2026-08-19T00:00:00.000Z"]);
});

test("occurrences before the anchor are never produced", () => {
  const trigger = { type: "schedule" as const, every: { days: 3, anchor: "2026-08-19" } };
  assert.deepEqual(
    occurrencesBetween(
      trigger,
      new Date("2026-08-01T00:00:00Z"),
      new Date("2026-08-18T00:00:00Z"),
      "UTC",
    ),
    [],
  );
});

test("every-days holds local wall-clock time across a DST shift", () => {
  const trigger = {
    type: "schedule" as const,
    every: { days: 1, anchor: "2026-10-24", at: "08:00" },
  };
  const found = occurrencesBetween(
    trigger,
    new Date("2026-10-23T00:00:00Z"),
    new Date("2026-10-28T00:00:00Z"),
    "Europe/Amsterdam",
  );
  const local = found.map((date) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Amsterdam",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(date),
  );
  assert.deepEqual(local, ["08:00", "08:00", "08:00", "08:00"]);
  // The clock went back an hour, so the UTC instants are not evenly spaced.
  assert.equal(found[1].toISOString(), "2026-10-25T07:00:00.000Z");
});

test("the limit caps the returned occurrences", () => {
  const trigger = { type: "schedule" as const, every: { days: 1, anchor: "2020-01-01" } };
  assert.equal(
    occurrencesBetween(
      trigger,
      new Date("2020-01-01T00:00:00Z"),
      new Date("2026-01-01T00:00:00Z"),
      "UTC",
      10,
    ).length,
    10,
  );
});

test("an empty window yields nothing", () => {
  const trigger = { type: "schedule" as const, cron: "0 8 * * *" };
  assert.deepEqual(
    occurrencesBetween(
      trigger,
      new Date("2026-08-26T00:00:00Z"),
      new Date("2026-08-25T00:00:00Z"),
      "UTC",
    ),
    [],
  );
});

test("nextOccurrenceAfter finds the following instant for both forms", () => {
  assert.equal(
    nextOccurrenceAfter(
      { type: "schedule", every: { days: 3, anchor: "2026-08-19", at: "08:00" } },
      new Date("2026-08-23T00:00:00Z"),
      "UTC",
    )?.toISOString(),
    "2026-08-25T08:00:00.000Z",
  );
  assert.equal(
    nextOccurrenceAfter(
      { type: "schedule", cron: "0 8 * * *" },
      new Date("2026-08-23T09:00:00Z"),
      "UTC",
    )?.toISOString(),
    "2026-08-24T08:00:00.000Z",
  );
});

test("parseScheduleTrigger accepts both supported forms", () => {
  assert.deepEqual(parseScheduleTrigger({ type: "schedule", cron: "0 8 * * *" }), {
    type: "schedule",
    cron: "0 8 * * *",
  });
  assert.deepEqual(
    parseScheduleTrigger({
      type: "schedule",
      every: { days: 3, anchor: "2026-08-19", at: "08:00" },
      timezone: "Europe/Amsterdam",
    }),
    {
      type: "schedule",
      every: { days: 3, anchor: "2026-08-19", at: "08:00" },
      timezone: "Europe/Amsterdam",
    },
  );
});

test("parseScheduleTrigger rejects malformed triggers", () => {
  const rejected: unknown[] = [
    { type: "schedule" },
    { type: "schedule", cron: "0 8 * * *", every: { days: 1, anchor: "2026-08-19" } },
    { type: "schedule", cron: "not a cron" },
    { type: "schedule", every: { anchor: "2026-08-19" } },
    { type: "schedule", every: { days: 0, anchor: "2026-08-19" } },
    { type: "schedule", every: { days: 1.5, anchor: "2026-08-19" } },
    { type: "schedule", every: { days: 1, weeks: 1, anchor: "2026-08-19" } },
    { type: "schedule", every: { days: 1, anchor: "19-08-2026" } },
    { type: "schedule", every: { days: 1, anchor: "2026-02-30" } },
    { type: "schedule", every: { days: 1, anchor: "2026-08-19", at: "25:00" } },
    { type: "schedule", every: { days: 1, anchor: "2026-08-19", at: "8am" } },
    { type: "card_created" },
  ];
  for (const value of rejected) assert.equal(parseScheduleTrigger(value), null, String(value));
});
