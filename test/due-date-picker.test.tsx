import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DueDatePicker } from "../src/components/board/DueDatePicker.tsx";
import {
  calendarDateAtOffset,
  dateFromCalendarDate,
  dateToCalendarDate,
} from "../src/lib/calendar-date.ts";

test("calendar dates round-trip without UTC shifting the selected day", () => {
  const date = dateFromCalendarDate("2026-07-22");
  assert.ok(date);
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 6);
  assert.equal(date.getDate(), 22);
  assert.equal(dateToCalendarDate(date), "2026-07-22");
  assert.equal(dateFromCalendarDate(null), undefined);
});

test("rule date offsets use the workspace calendar day", () => {
  const instant = new Date("2026-07-22T22:30:00Z");
  assert.equal(calendarDateAtOffset(instant, 0, "Europe/Amsterdam"), "2026-07-23");
  assert.equal(calendarDateAtOffset(instant, 1, "Europe/Amsterdam"), "2026-07-24");
  assert.equal(calendarDateAtOffset(instant, -1, "Europe/Amsterdam"), "2026-07-22");
});

test("due-date picker has a clear accessible trigger and uses themed primitives", async () => {
  const html = renderToStaticMarkup(<DueDatePicker dueDate="2026-07-22" onChange={() => {}} />);
  assert.match(html, /aria-label="Change due date, July 22, 2026"/);
  assert.match(html, />Jul 22, 2026</);
  assert.doesNotMatch(html, /type="date"/);

  const pickerSource = await readFile(
    new URL("../src/components/board/DueDatePicker.tsx", import.meta.url),
    "utf8",
  );
  assert.match(pickerSource, /<Calendar/);
  assert.match(pickerSource, /<Popover/);
  assert.match(pickerSource, /onSelect/);
  assert.match(pickerSource, /Clear/);

  const modalSource = await readFile(
    new URL("../src/components/board/CardModal.tsx", import.meta.url),
    "utf8",
  );
  assert.match(modalSource, /<DueDatePicker/);
  assert.doesNotMatch(modalSource, /type="date"/);
});

test("empty due-date picker invites selection", () => {
  const html = renderToStaticMarkup(<DueDatePicker dueDate={null} onChange={() => {}} />);
  assert.match(html, /aria-label="Set due date"/);
  assert.match(html, />Due date</);
});
