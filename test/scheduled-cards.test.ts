import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";

import { readWorkspaceBoard } from "../src/lib/workspace/board-repository.ts";
import { initializeWorkspace } from "../src/lib/workspace/initializer.ts";
import { runScheduledRule, startWorkspaceJobs } from "../src/lib/workspace/rule-runner.ts";
import { createCardForOccurrence } from "../src/lib/workspace/scheduled-cards.ts";
import { readWatermark } from "../src/lib/workspace/schedule-state.ts";
import { writeWorkspaceTemplates } from "../src/lib/workspace/templates-repository.ts";
import { validateWorkspace } from "../src/lib/workspace/validator.ts";

const created = "2026-08-19T06:00:00Z";
const clock = new Date(created);
const occurrence = new Date("2026-08-26T08:00:00Z");

async function makeWorkspace(
  options: { templateColumn?: string | null; ruleColumn?: string; checklist?: string[] } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "flowmark-scheduled-cards-"));
  await initializeWorkspace(root);
  await writeFile(
    join(root, "columns/column_planned.yaml"),
    `schema_version: 1
id: column_planned
name: Planned
position: 2048
color: neutral
created_at: ${created}
updated_at: ${created}
`,
  );
  const workspacePath = join(root, "flowmark.yaml");
  const workspace = parse(await readFile(workspacePath, "utf8"));
  workspace.ui.column_order.push("column_planned");
  await writeFile(workspacePath, `${JSON.stringify(workspace)}\n`);
  await writeFile(
    join(root, "tags/tag_music.yaml"),
    `schema_version: 1
id: tag_music
name: Music
color: violet
description: null
created_at: ${created}
updated_at: ${created}
`,
  );
  await writeWorkspaceTemplates(
    root,
    {
      templates: [
        {
          id: "template_piano",
          name: "Piano practice",
          title: "Piano · {{date:iso}}",
          body: "Practice on {{weekday}}.\n",
          columnId:
            options.templateColumn === undefined ? "column_planned" : options.templateColumn,
          tagIds: ["tag_music"],
          due: { mode: "offset", offsetDays: 2 },
          checklist: options.checklist ?? ["Scales", "Piece for week {{week}}"],
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
enabled: true
trigger:
  type: schedule
  cron: "0 8 * * *"
actions:
  - type: create_card
    template_id: template_piano${options.ruleColumn ? `\n    column_id: ${options.ruleColumn}` : ""}
created_at: ${created}
updated_at: ${created}
`,
  );
  return root;
}

async function cardFrontmatter(root: string, cardId: string) {
  const source = await readFile(join(root, "cards", `${cardId}.md`), "utf8");
  return parse(/^---\n([\s\S]*?)\n---/.exec(source)![1]);
}

test("a scheduled occurrence creates a card from its template", async () => {
  const root = await makeWorkspace();
  const cardId = await createCardForOccurrence(root, "rule_piano", occurrence);
  assert.ok(cardId);

  const board = await readWorkspaceBoard(root);
  const card = board.cards[cardId];
  assert.equal(card.title, "Piano · 2026-08-26");
  assert.equal(card.description, "Practice on Wednesday.\n");
  assert.equal(card.dueDate, "2026-08-28");
  assert.deepEqual(card.tagIds, ["tag_music"]);
  assert.deepEqual(
    card.checklist.map((item) => item.text),
    ["Scales", "Piece for week 35"],
  );
  assert.ok(
    board.columns.find((column) => column.id === "column_planned")?.cardIds.includes(cardId),
  );
  await rm(root, { recursive: true, force: true });
});

test("the created card records the rule, template, and occurrence that made it", async () => {
  const root = await makeWorkspace();
  const cardId = (await createCardForOccurrence(root, "rule_piano", occurrence))!;
  assert.deepEqual((await cardFrontmatter(root, cardId)).origin, {
    rule_id: "rule_piano",
    template_id: "template_piano",
    occurrence: "2026-08-26T08:00:00.000Z",
  });
  await rm(root, { recursive: true, force: true });
});

test("the workspace stays valid after a scheduled creation", async () => {
  const root = await makeWorkspace();
  await createCardForOccurrence(root, "rule_piano", occurrence);
  assert.deepEqual((await validateWorkspace(root)).errors, []);
  await rm(root, { recursive: true, force: true });
});

test("the same occurrence never creates a second card", async () => {
  const root = await makeWorkspace();
  const first = await createCardForOccurrence(root, "rule_piano", occurrence);
  const second = await createCardForOccurrence(root, "rule_piano", occurrence);
  assert.ok(first);
  assert.equal(second, null);
  assert.equal(Object.keys((await readWorkspaceBoard(root)).cards).length, 1);
  await rm(root, { recursive: true, force: true });
});

test("a different occurrence of the same rule creates another card", async () => {
  const root = await makeWorkspace();
  await createCardForOccurrence(root, "rule_piano", occurrence);
  await createCardForOccurrence(root, "rule_piano", new Date("2026-08-27T08:00:00Z"));
  assert.equal(Object.keys((await readWorkspaceBoard(root)).cards).length, 2);
  await rm(root, { recursive: true, force: true });
});

test("the rule action column overrides the template column", async () => {
  const root = await makeWorkspace({ ruleColumn: "column_inbox" });
  const cardId = (await createCardForOccurrence(root, "rule_piano", occurrence))!;
  const board = await readWorkspaceBoard(root);
  assert.ok(board.columns.find((column) => column.id === "column_inbox")?.cardIds.includes(cardId));
  await rm(root, { recursive: true, force: true });
});

test("a template without a column falls back to the workspace default", async () => {
  const root = await makeWorkspace({ templateColumn: null });
  const cardId = (await createCardForOccurrence(root, "rule_piano", occurrence))!;
  const board = await readWorkspaceBoard(root);
  assert.ok(board.columns.find((column) => column.id === "column_inbox")?.cardIds.includes(cardId));
  await rm(root, { recursive: true, force: true });
});

test("a template with no checklist creates a card without one", async () => {
  const root = await makeWorkspace({ checklist: [] });
  const cardId = (await createCardForOccurrence(root, "rule_piano", occurrence))!;
  const board = await readWorkspaceBoard(root);
  assert.deepEqual(board.cards[cardId].checklist, []);
  assert.deepEqual((await cardFrontmatter(root, cardId)).checklist_ids, []);
  await rm(root, { recursive: true, force: true });
});

test("event rules route the new card onward", async () => {
  const root = await makeWorkspace({ templateColumn: "column_inbox" });
  await writeFile(
    join(root, "rules/rule_route.yaml"),
    `schema_version: 1
id: rule_route
name: Route new cards
enabled: true
trigger:
  type: card_created
actions:
  - type: move_card
    column_id: column_planned
created_at: ${created}
updated_at: ${created}
`,
  );
  const cardId = (await createCardForOccurrence(root, "rule_piano", occurrence))!;
  const board = await readWorkspaceBoard(root);
  assert.ok(
    board.columns.find((column) => column.id === "column_planned")?.cardIds.includes(cardId),
    "the card_created rule should have moved the new card",
  );
  await rm(root, { recursive: true, force: true });
});

test("running the scheduled rule creates the card and advances the watermark", async () => {
  const root = await makeWorkspace();
  const affected = await runScheduledRule(root, "rule_piano", occurrence);
  assert.equal(affected, 1);
  assert.equal(Object.keys((await readWorkspaceBoard(root)).cards).length, 1);
  assert.equal(await readWatermark(root, "rule_piano"), "2026-08-26T08:00:00.000Z");
  await rm(root, { recursive: true, force: true });
});

test("running the scheduled rule twice for one occurrence stays idempotent", async () => {
  const root = await makeWorkspace();
  await runScheduledRule(root, "rule_piano", occurrence);
  const second = await runScheduledRule(root, "rule_piano", occurrence);
  assert.equal(second, 0);
  assert.equal(Object.keys((await readWorkspaceBoard(root)).cards).length, 1);
  await rm(root, { recursive: true, force: true });
});

test("an every-interval rule arms a timer for its next occurrence and fires it", async () => {
  const root = await makeWorkspace();
  await writeFile(
    join(root, "rules/rule_piano.yaml"),
    `schema_version: 1
id: rule_piano
name: Piano practice
enabled: true
trigger:
  type: schedule
  every:
    days: 3
    anchor: 2026-08-19
    at: "08:00"
  timezone: UTC
actions:
  - type: create_card
    template_id: template_piano
created_at: ${created}
updated_at: ${created}
`,
  );

  const armed: { delay: number; fire: () => void }[] = [];
  const cleared: unknown[] = [];
  const scheduler = {
    setTimeout: (callback: () => void, delayMs: number) => {
      const handle = { delay: delayMs, fire: callback };
      armed.push(handle);
      return handle;
    },
    clearTimeout: (handle: unknown) => cleared.push(handle),
  };

  // Two days past the 22nd occurrence, so the next one is the 25th at 08:00.
  const nowValue = new Date("2026-08-23T09:00:00Z");
  const stop = await startWorkspaceJobs(root, { now: () => nowValue, scheduler });
  try {
    assert.equal(armed.length, 1);
    assert.equal(
      armed[0].delay,
      new Date("2026-08-25T08:00:00Z").getTime() - nowValue.getTime(),
      "the timer should wait exactly until the next occurrence",
    );

    // Wait on the re-arm rather than on the card: the run writes the card
    // before its promise settles, so polling the board can outrun the timer.
    armed[0].fire();
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && armed.length < 2)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(armed.length, 2, "the timer should re-arm itself for the following occurrence");

    assert.equal(
      Object.keys((await readWorkspaceBoard(root)).cards).length,
      1,
      "firing the timer should create the occurrence card",
    );
    assert.equal(await readWatermark(root, "rule_piano"), "2026-08-25T08:00:00.000Z");
  } finally {
    stop();
  }
  assert.deepEqual(cleared, [armed[1]], "stopping should clear the outstanding timer");
  await rm(root, { recursive: true, force: true });
});
