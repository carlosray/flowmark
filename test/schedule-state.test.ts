import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { initializeWorkspace } from "../src/lib/workspace/initializer.ts";
import {
  PENDING_SERIES_THRESHOLD,
  pendingOccurrences,
  readWatermark,
  resolveWatermark,
  writeWatermark,
} from "../src/lib/workspace/schedule-state.ts";
import { writeWorkspaceTemplates } from "../src/lib/workspace/templates-repository.ts";

const created = "2026-08-19T06:00:00Z";
const clock = new Date(created);

async function makeWorkspace(options: { enabled?: boolean; action?: string } = {}) {
  const root = await mkdtemp(join(tmpdir(), "flowmark-schedule-state-"));
  await initializeWorkspace(root);
  await writeWorkspaceTemplates(
    root,
    {
      templates: [
        {
          id: "template_piano",
          name: "Piano practice",
          title: "Piano · {{date:iso}}",
          body: "",
          columnId: "column_inbox",
          tagIds: [],
          due: { mode: "offset", offsetDays: 2 },
          checklist: [],
        },
      ],
      deletedIds: [],
    },
    clock,
  );
  await writeFile(
    join(root, "rules/rule_piano.yaml"),
    `schema_version: 1
id: rule_piano
name: Piano practice
enabled: ${options.enabled ?? true}
trigger:
  type: schedule
  cron: "0 8 * * *"
actions:
  - ${options.action ?? "type: create_card\n    template_id: template_piano"}
created_at: ${created}
updated_at: ${created}
`,
  );
  return root;
}

async function writeOriginCard(root: string, id: string, occurrence: string, archived = false) {
  const directory = archived ? "archive/cards" : "cards";
  await writeFile(
    join(root, directory, `${id}.md`),
    `---
schema_version: 1
id: ${id}
title: Piano
column_id: ${archived ? "null" : "column_inbox"}
previous_column_id: ${archived ? "column_inbox" : "null"}
position: 1024
completed: false
completed_at: null
due_at: null
tag_ids: []
checklist_ids: []
comment_ids: []
origin:
  rule_id: rule_piano
  template_id: template_piano
  occurrence: ${occurrence}
created_at: ${created}
updated_at: ${created}
archived_at: ${archived ? created : "null"}
---

Body.
`,
  );
}

test("a watermark round-trips through the runtime directory", async () => {
  const root = await makeWorkspace();
  assert.equal(await readWatermark(root, "rule_piano"), null);
  await writeWatermark(root, "rule_piano", "2026-08-22T08:00:00.000Z");
  assert.equal(await readWatermark(root, "rule_piano"), "2026-08-22T08:00:00.000Z");
  await rm(root, { recursive: true, force: true });
});

test("a missing watermark falls back to the rule creation time", async () => {
  const root = await makeWorkspace();
  assert.equal(await resolveWatermark(root, "rule_piano", created), created);
  await rm(root, { recursive: true, force: true });
});

test("a missing watermark rebuilds from the newest card origin", async () => {
  const root = await makeWorkspace();
  await writeOriginCard(root, "card_one", "2026-08-20T08:00:00Z");
  await writeOriginCard(root, "card_two", "2026-08-22T08:00:00Z");
  assert.equal(await resolveWatermark(root, "rule_piano", created), "2026-08-22T08:00:00Z");
  await rm(root, { recursive: true, force: true });
});

test("the rebuild also sees archived cards", async () => {
  const root = await makeWorkspace();
  await writeOriginCard(root, "card_old", "2026-08-21T08:00:00Z", true);
  assert.equal(await resolveWatermark(root, "rule_piano", created), "2026-08-21T08:00:00Z");
  await rm(root, { recursive: true, force: true });
});

test("a stored watermark wins over the card rebuild", async () => {
  const root = await makeWorkspace();
  await writeOriginCard(root, "card_one", "2026-08-20T08:00:00Z");
  await writeWatermark(root, "rule_piano", "2026-08-24T08:00:00.000Z");
  assert.equal(await resolveWatermark(root, "rule_piano", created), "2026-08-24T08:00:00.000Z");
  await rm(root, { recursive: true, force: true });
});

test("pending occurrences list every missed run since the rule was created", async () => {
  const root = await makeWorkspace();
  const series = await pendingOccurrences(root, new Date("2026-08-23T09:00:00Z"));
  assert.equal(series.length, 1);
  assert.equal(series[0].ruleId, "rule_piano");
  assert.equal(series[0].templateId, "template_piano");
  assert.deepEqual(series[0].occurrences, [
    "2026-08-19T08:00:00.000Z",
    "2026-08-20T08:00:00.000Z",
    "2026-08-21T08:00:00.000Z",
    "2026-08-22T08:00:00.000Z",
    "2026-08-23T08:00:00.000Z",
  ]);
  assert.equal(series[0].collapsed, false);
  await rm(root, { recursive: true, force: true });
});

test("pending occurrences preview the title each card would get", async () => {
  const root = await makeWorkspace();
  const [series] = await pendingOccurrences(root, new Date("2026-08-21T09:00:00Z"));
  assert.deepEqual(series.previews, [
    "Piano · 2026-08-19",
    "Piano · 2026-08-20",
    "Piano · 2026-08-21",
  ]);
  await rm(root, { recursive: true, force: true });
});

test("advancing the watermark removes the occurrences it covers", async () => {
  const root = await makeWorkspace();
  await writeWatermark(root, "rule_piano", "2026-08-22T08:00:00.000Z");
  const [series] = await pendingOccurrences(root, new Date("2026-08-23T09:00:00Z"));
  assert.deepEqual(series.occurrences, ["2026-08-23T08:00:00.000Z"]);
  await rm(root, { recursive: true, force: true });
});

test("nothing is pending when the watermark is current", async () => {
  const root = await makeWorkspace();
  await writeWatermark(root, "rule_piano", "2026-08-23T08:00:00.000Z");
  assert.deepEqual(await pendingOccurrences(root, new Date("2026-08-23T09:00:00Z")), []);
  await rm(root, { recursive: true, force: true });
});

test("a freshly created rule backfills nothing", async () => {
  const root = await makeWorkspace();
  assert.deepEqual(await pendingOccurrences(root, new Date("2026-08-19T07:00:00Z")), []);
  await rm(root, { recursive: true, force: true });
});

test("a disabled rule has no pending occurrences", async () => {
  const root = await makeWorkspace({ enabled: false });
  assert.deepEqual(await pendingOccurrences(root, new Date("2026-08-23T09:00:00Z")), []);
  await rm(root, { recursive: true, force: true });
});

test("a scheduled rule that does not create cards has no pending occurrences", async () => {
  const root = await makeWorkspace({
    action:
      "type: sort_cards\n    scope: all_columns\n    by: due_at\n    direction: ascending\n    nulls: last",
  });
  assert.deepEqual(await pendingOccurrences(root, new Date("2026-08-23T09:00:00Z")), []);
  await rm(root, { recursive: true, force: true });
});

test("a long absence collapses into one series without per-run previews", async () => {
  const root = await makeWorkspace();
  const [series] = await pendingOccurrences(root, new Date("2026-10-15T09:00:00Z"));
  assert.ok(series.occurrences.length > PENDING_SERIES_THRESHOLD);
  assert.equal(series.collapsed, true);
  assert.deepEqual(series.previews, []);
  await rm(root, { recursive: true, force: true });
});
