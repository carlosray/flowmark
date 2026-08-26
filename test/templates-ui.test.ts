import assert from "node:assert/strict";
import test from "node:test";

import {
  MissedOccurrencesStore,
  advanceQueue,
  defaultDecisionFor,
  describeQueueItem,
  occurrenceDecisionOptions,
  queueFromSeries,
} from "../src/lib/missed-occurrences.ts";
import {
  emptyTemplate,
  templateDueLabel,
  templateDueModeOptions,
  templateIssues,
  templatePreview,
  templateVariableRows,
  withDueMode,
} from "../src/lib/templates-ui.ts";
import type { PendingSeries } from "../src/lib/workspace/schedule-state.ts";
import type { CardTemplate } from "../src/lib/workspace/templates-repository.ts";

const context = {
  occurrence: new Date("2026-08-26T08:00:00Z"),
  dueDate: "2026-08-28",
  timeZone: "UTC",
  locale: "en",
};

function piano(overrides: Partial<CardTemplate> = {}): CardTemplate {
  return {
    id: "template_piano",
    name: "Piano practice",
    title: "Piano · {{date:iso}}",
    body: "Practice on {{weekday}}.",
    columnId: "column_inbox",
    tagIds: [],
    due: { mode: "offset", offsetDays: 2 },
    checklist: ["Scales"],
    ...overrides,
  };
}

test("the editor offers all three due modes", () => {
  assert.deepEqual(
    templateDueModeOptions().map(([mode]) => mode),
    ["none", "offset", "fixed"],
  );
});

test("due labels read as plain sentences", () => {
  assert.equal(templateDueLabel({ mode: "none" }), "No due date");
  assert.equal(templateDueLabel({ mode: "offset", offsetDays: 0 }), "Due the day it is created");
  assert.equal(
    templateDueLabel({ mode: "offset", offsetDays: 1 }),
    "Due the day after it is created",
  );
  assert.equal(
    templateDueLabel({ mode: "offset", offsetDays: 3 }),
    "Due 3 days after it is created",
  );
  assert.equal(
    templateDueLabel({ mode: "offset", offsetDays: -2 }),
    "Due 2 days before it is created",
  );
  assert.equal(templateDueLabel({ mode: "fixed", date: "2026-09-01" }), "Due 2026-09-01");
});

test("switching due mode and back keeps the value that was typed", () => {
  const offset = { mode: "offset", offsetDays: 5 } as const;
  const none = withDueMode(offset, "none", "2026-08-26");
  assert.deepEqual(none, { mode: "none" });
  assert.deepEqual(withDueMode(none, "offset", "2026-08-26"), { mode: "offset", offsetDays: 0 });
  assert.deepEqual(withDueMode(offset, "offset", "2026-08-26"), offset);
});

test("switching to a fixed date seeds today", () => {
  assert.deepEqual(withDueMode({ mode: "none" }, "fixed", "2026-08-26"), {
    mode: "fixed",
    date: "2026-08-26",
  });
});

test("a well-formed template has no issues", () => {
  assert.deepEqual(templateIssues(piano()), []);
});

test("issues name the field and the broken expression", () => {
  assert.match(templateIssues(piano({ title: "{{nope}}" }))[0], /^Title: \{\{nope\}\}/);
  assert.match(templateIssues(piano({ body: "{{nope}}" }))[0], /^Description:/);
  assert.match(templateIssues(piano({ checklist: ["{{nope}}"] }))[0], /^Checklist item 1:/);
});

test("a missing name or title blocks saving", () => {
  assert.ok(templateIssues(piano({ name: "  " })).some((issue) => /name/i.test(issue)));
  assert.ok(templateIssues(piano({ title: "" })).some((issue) => /title/i.test(issue)));
});

test("an incomplete fixed date blocks saving", () => {
  assert.ok(
    templateIssues(piano({ due: { mode: "fixed", date: "" } })).some((issue) =>
      /date/i.test(issue),
    ),
  );
});

test("the preview shows what the card would become", () => {
  const preview = templatePreview(piano(), context);
  assert.equal(preview.title, "Piano · 2026-08-26");
  assert.equal(preview.body, "Practice on Wednesday.");
  assert.deepEqual(preview.checklist, ["Scales"]);
});

test("the preview resolves due_date from the template's own due mode", () => {
  assert.equal(
    templatePreview(piano({ title: "{{due_date}}", due: { mode: "fixed", date: "2026-09-01" } }), {
      ...context,
      dueDate: null,
    }).title,
    "2026-09-01",
  );
  assert.equal(
    templatePreview(piano({ title: "{{due_date}}", due: { mode: "none" } }), context).title,
    "",
  );
});

test("the variables panel lists every expression with a value", () => {
  const rows = templateVariableRows(context);
  assert.deepEqual(
    rows.map((row) => row.expression),
    ["{{date}}", "{{due_date}}", "{{weekday}}", "{{week}}"],
  );
  assert.ok(rows.every((row) => row.preview.length > 0));
});

test("a new template starts empty but placed", () => {
  const fresh = emptyTemplate("template_new", "column_inbox");
  assert.equal(fresh.columnId, "column_inbox");
  assert.deepEqual(fresh.due, { mode: "none" });
  assert.ok(templateIssues(fresh).some((issue) => /title/i.test(issue)));
});

const series: PendingSeries[] = [
  {
    ruleId: "rule_piano",
    ruleName: "Piano practice",
    templateId: "template_piano",
    occurrences: ["2026-08-19T08:00:00.000Z", "2026-08-20T08:00:00.000Z"],
    previews: ["Piano · 2026-08-19", "Piano · 2026-08-20"],
    collapsed: false,
  },
];

test("each missed occurrence becomes its own question", () => {
  const queue = queueFromSeries(series);
  assert.equal(queue.length, 2);
  assert.equal(queue[0].preview, "Piano · 2026-08-19");
  assert.equal(queue[0].seriesCount, 2);
});

test("a collapsed series becomes a single question", () => {
  const queue = queueFromSeries([
    { ...series[0], collapsed: true, previews: [], occurrences: series[0].occurrences },
  ]);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].collapsed, true);
  assert.equal(queue[0].seriesStart, "2026-08-19T08:00:00.000Z");
  assert.equal(queue[0].seriesEnd, "2026-08-20T08:00:00.000Z");
});

test("answering one occurrence removes only that question", () => {
  const queue = queueFromSeries(series);
  assert.deepEqual(
    advanceQueue(queue, queue[0], "repeat").map((item) => item.occurrence),
    ["2026-08-20T08:00:00.000Z"],
  );
  assert.deepEqual(
    advanceQueue(queue, queue[0], "skip").map((item) => item.occurrence),
    ["2026-08-20T08:00:00.000Z"],
  );
});

test("a series answer clears every question for that rule", () => {
  const queue = queueFromSeries([
    ...series,
    { ...series[0], ruleId: "rule_other", ruleName: "Other" },
  ]);
  for (const decision of ["repeat_series", "decline_series"] as const)
    assert.deepEqual(
      new Set(advanceQueue(queue, queue[0], decision).map((item) => item.ruleId)),
      new Set(["rule_other"]),
    );
});

test("a collapsed question offers only the series answers", () => {
  assert.deepEqual(
    occurrenceDecisionOptions(true).map(([decision]) => decision),
    ["repeat_series", "decline_series"],
  );
  assert.deepEqual(
    occurrenceDecisionOptions(false).map(([decision]) => decision),
    ["repeat", "skip", "repeat_series", "decline_series"],
  );
});

test("Enter creates the card, and creates the series when collapsed", () => {
  const [single] = queueFromSeries(series);
  const [collapsed] = queueFromSeries([{ ...series[0], collapsed: true, previews: [] }]);
  assert.equal(defaultDecisionFor(single), "repeat");
  assert.equal(defaultDecisionFor(collapsed), "repeat_series");
});

test("questions describe themselves in plain language", () => {
  const format = (iso: string) => iso.slice(0, 10);
  const [single] = queueFromSeries(series);
  const [collapsed] = queueFromSeries([{ ...series[0], collapsed: true, previews: [] }]);
  assert.equal(
    describeQueueItem(single, format),
    "Piano practice was due to create a card on 2026-08-19.",
  );
  assert.equal(
    describeQueueItem(collapsed, format),
    "Piano practice missed 2 runs between 2026-08-19 and 2026-08-20.",
  );
});

function makeStore(series: PendingSeries[]) {
  const calls: { ruleId: string; occurrence: string; decision: string }[] = [];
  let refreshed = 0;
  const store = new MissedOccurrencesStore(
    {
      read: async () => ({ series }),
      resolve: async (request) => {
        calls.push(request);
        return { created: request.decision.startsWith("repeat") ? ["card_new"] : [] };
      },
    },
    () => {
      refreshed += 1;
    },
  );
  return { store, calls, refreshedCount: () => refreshed };
}

test("the store loads the queue and answers one question at a time", async () => {
  const { store, calls } = makeStore(series);
  await store.reload();
  assert.equal(store.getSnapshot().queue.length, 2);

  const [first] = store.getSnapshot().queue;
  await store.answer(first, "repeat");
  assert.deepEqual(calls, [
    { ruleId: "rule_piano", occurrence: "2026-08-19T08:00:00.000Z", decision: "repeat" },
  ]);
  assert.equal(store.getSnapshot().queue.length, 1);
});

test("answering the last question empties the queue", async () => {
  const { store } = makeStore(series);
  await store.reload();
  for (const item of [...store.getSnapshot().queue]) await store.answer(item, "skip");
  assert.deepEqual(store.getSnapshot().queue, []);
});

test("a series answer clears the rule in one call", async () => {
  const { store, calls } = makeStore(series);
  await store.reload();
  await store.answer(store.getSnapshot().queue[0], "decline_series");
  assert.equal(calls.length, 1);
  assert.deepEqual(store.getSnapshot().queue, []);
});

test("creating cards asks the board to refresh", async () => {
  const { store, refreshedCount } = makeStore(series);
  await store.reload();
  await store.answer(store.getSnapshot().queue[0], "skip");
  assert.equal(refreshedCount(), 0);
  await store.answer(store.getSnapshot().queue[0], "repeat");
  assert.equal(refreshedCount(), 1);
});

test("dismissing defers the remaining questions without answering them", async () => {
  const { store, calls } = makeStore(series);
  await store.reload();
  store.dismiss();
  assert.deepEqual(store.getSnapshot().queue, []);
  assert.deepEqual(calls, []);
});

test("a failed answer keeps the question and surfaces the reason", async () => {
  const store = new MissedOccurrencesStore({
    read: async () => ({ series }),
    resolve: async () => {
      throw new Error("workspace is invalid");
    },
  });
  await store.reload();
  const before = store.getSnapshot().queue.length;
  await store.answer(store.getSnapshot().queue[0], "repeat");
  assert.equal(store.getSnapshot().queue.length, before);
  assert.match(store.getSnapshot().error ?? "", /workspace is invalid/);
  assert.equal(store.getSnapshot().busy, false);
});
