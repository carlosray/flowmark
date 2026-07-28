import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse, stringify } from "yaml";

import { initializeWorkspace } from "../src/lib/workspace/initializer.ts";
import {
  nextWorkspaceMidnight,
  reconcileWorkspaceRules,
  runScheduledRule,
  startWorkspaceJobs,
} from "../src/lib/workspace/rule-runner.ts";
import { validateWorkspace } from "../src/lib/workspace/validator.ts";

async function makeDateWorkspace(dueAt = "2026-07-24T00:00:00Z") {
  const root = await mkdtemp(join(tmpdir(), "flowmark-rule-runner-"));
  await initializeWorkspace(root);
  const timestamp = "2026-07-20T10:00:00Z";
  await writeFile(
    join(root, "columns/column_planned.yaml"),
    `schema_version: 1
id: column_planned
name: Planned
position: 2048
color: neutral
created_at: ${timestamp}
updated_at: ${timestamp}
`,
  );
  const workspacePath = join(root, "flowmark.yaml");
  const workspace = parse(await readFile(workspacePath, "utf8"));
  workspace.ui.column_order.push("column_planned");
  await writeFile(workspacePath, stringify(workspace));
  await writeFile(
    join(root, "cards/card_test.md"),
    `---
schema_version: 1
id: card_test
title: Test
column_id: column_inbox
position: 1024
completed: false
completed_at: null
due_at: ${dueAt}
tag_ids: []
checklist_ids: []
comment_ids: []
created_at: ${timestamp}
updated_at: ${timestamp}
archived_at: null
---

Keep this body.
`,
  );
  await writeFile(
    join(root, "rules/rule_future_to_planned.yaml"),
    `schema_version: 1
id: rule_future_to_planned
name: Route future cards
enabled: true
trigger: { type: due_state_changed }
conditions:
  - { type: completed, value: false }
  - { type: due_state, value: future }
actions:
  - { type: move_card, column_id: column_planned }
created_at: ${timestamp}
updated_at: ${timestamp}
`,
  );
  return root;
}

test("startup reconciliation applies current due state and is an exact no-op afterward", async () => {
  const root = await makeDateWorkspace();
  try {
    const first = await reconcileWorkspaceRules(root, new Date("2026-07-22T10:00:00Z"));
    assert.equal(first.changed, true);
    assert.equal(first.operations, 1);
    assert.equal(
      parse((await readFile(join(root, "cards/card_test.md"), "utf8")).split("---")[1]).column_id,
      "column_planned",
    );
    const cardAfterFirstRun = await readFile(join(root, "cards/card_test.md"), "utf8");

    const second = await reconcileWorkspaceRules(root, new Date("2026-07-22T10:05:00Z"));
    assert.equal(second.changed, false);
    assert.equal(await readFile(join(root, "cards/card_test.md"), "utf8"), cardAfterFirstRun);
    assert.deepEqual((await validateWorkspace(root, { strict: true })).errors, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("startup reconciliation also reapplies completion state rules", async () => {
  const root = await makeDateWorkspace();
  try {
    const cardPath = join(root, "cards/card_test.md");
    await writeFile(
      cardPath,
      (await readFile(cardPath, "utf8"))
        .replace("completed: false", "completed: true")
        .replace("completed_at: null", "completed_at: 2026-07-21T10:00:00Z"),
    );
    await writeFile(
      join(root, "rules/rule_completed_to_planned.yaml"),
      `schema_version: 1
id: rule_completed_to_planned
name: Reconcile completion
enabled: true
trigger: { type: card_completed }
actions: [{ type: move_card, column_id: column_planned }]
created_at: 2026-07-20T10:00:00Z
updated_at: 2026-07-20T10:00:00Z
`,
    );

    const result = await reconcileWorkspaceRules(root, new Date("2026-07-22T10:00:00Z"));
    assert.equal(result.changed, true);
    assert.match(await readFile(cardPath, "utf8"), /column_id: column_planned/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("startup reconciliation does not synthesize reopen events for ordinary open cards", async () => {
  const root = await makeDateWorkspace("2026-07-24T00:00:00Z");
  try {
    await writeFile(
      join(root, "rules/rule_reopen_clear.yaml"),
      `schema_version: 1
id: rule_reopen_clear
name: Clear only on a real reopen
enabled: true
trigger: { type: card_uncompleted }
actions: [{ type: clear_due_date }]
created_at: 2026-07-20T10:00:00Z
updated_at: 2026-07-20T10:00:00Z
`,
    );

    await reconcileWorkspaceRules(root, new Date("2026-07-22T10:00:00Z"));
    const cardSource = await readFile(join(root, "cards/card_test.md"), "utf8");
    assert.match(cardSource, /due_at: 2026-07-24T00:00:00Z/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("startup reconciliation reports conditioned cycles without persisting partial changes", async () => {
  const root = await makeDateWorkspace();
  try {
    const timestamp = "2026-07-20T10:00:00Z";
    await writeFile(
      join(root, "rules/rule_start_cycle.yaml"),
      `schema_version: 1
id: rule_start_cycle
name: Start conditioned cycle
enabled: true
trigger: { type: due_state_changed }
conditions:
  - { type: due_state, value: future }
  - { type: column, operator: in, column_ids: [column_inbox] }
actions: [{ type: move_card, column_id: column_planned }]
created_at: ${timestamp}
updated_at: ${timestamp}
`,
    );
    await writeFile(
      join(root, "rules/rule_cycle_to_inbox.yaml"),
      `schema_version: 1
id: rule_cycle_to_inbox
name: Conditioned cycle to inbox
enabled: true
trigger: { type: card_entered_column, column_id: column_planned }
conditions: [{ type: due_state, value: future }]
actions: [{ type: move_card, column_id: column_inbox }]
created_at: ${timestamp}
updated_at: ${timestamp}
`,
    );
    await writeFile(
      join(root, "rules/rule_cycle_to_planned.yaml"),
      `schema_version: 1
id: rule_cycle_to_planned
name: Conditioned cycle to planned
enabled: true
trigger: { type: card_entered_column, column_id: column_inbox }
conditions: [{ type: due_state, value: future }]
actions: [{ type: move_card, column_id: column_planned }]
created_at: ${timestamp}
updated_at: ${timestamp}
`,
    );
    const original = await readFile(join(root, "cards/card_test.md"), "utf8");

    const result = await reconcileWorkspaceRules(root, new Date("2026-07-22T10:00:00Z"));

    assert.equal(result.changed, false);
    assert.match(result.diagnostics.map(({ code }) => code).join("\n"), /E_RULE_CYCLE/);
    assert.equal(await readFile(join(root, "cards/card_test.md"), "utf8"), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("startWorkspaceJobs awaits reconciliation before returning", async () => {
  const root = await makeDateWorkspace();
  try {
    const stop = await startWorkspaceJobs(root, { now: () => new Date("2026-07-22T10:00:00Z") });
    try {
      const cardSource = await readFile(join(root, "cards/card_test.md"), "utf8");
      assert.match(cardSource, /column_id: column_planned/);
    } finally {
      stop();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("next workspace midnight follows the IANA timezone across DST", () => {
  assert.equal(
    nextWorkspaceMidnight(new Date("2026-07-22T10:00:00Z"), "Europe/Amsterdam").toISOString(),
    "2026-07-22T22:00:00.000Z",
  );
  assert.equal(
    nextWorkspaceMidnight(new Date("2026-10-25T12:00:00Z"), "Europe/Amsterdam").toISOString(),
    "2026-10-25T23:00:00.000Z",
  );
});

test("scheduled rules support future/tomorrow states and in/not_in column membership", async () => {
  const root = await makeDateWorkspace("2026-07-23T00:00:00Z");
  try {
    const timestamp = "2026-07-20T10:00:00Z";
    await writeFile(
      join(root, "rules/rule_scheduled_tomorrow.yaml"),
      `schema_version: 1
id: rule_scheduled_tomorrow
name: Route tomorrow from inbox
enabled: true
trigger: { type: schedule, cron: "0 8 * * *", timezone: Europe/Amsterdam }
conditions:
  - { type: due_state, value: tomorrow }
  - { type: column, operator: in, column_ids: [column_inbox] }
  - { type: column, operator: not_in, column_ids: [column_planned] }
actions:
  - { type: move_card, column_id: column_planned }
created_at: ${timestamp}
updated_at: ${timestamp}
`,
    );

    assert.equal(
      await runScheduledRule(root, "rule_scheduled_tomorrow", new Date("2026-07-22T10:00:00Z")),
      1,
    );
    assert.deepEqual((await validateWorkspace(root, { strict: true })).errors, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("scheduled unchanged actions are exact no-ops and sorting is stable with nulls last", async () => {
  const root = await makeDateWorkspace("2026-07-24T00:00:00Z");
  try {
    const timestamp = "2026-07-20T10:00:00Z";
    await writeFile(
      join(root, "cards/card_undated.md"),
      `---
schema_version: 1
id: card_undated
title: Undated
column_id: column_inbox
position: 2048
completed: false
completed_at: null
due_at: null
tag_ids: []
checklist_ids: []
comment_ids: []
created_at: ${timestamp}
updated_at: ${timestamp}
archived_at: null
---

Undated.
`,
    );
    await writeFile(
      join(root, "cards/card_earlier.md"),
      `---
schema_version: 1
id: card_earlier
title: Earlier
column_id: column_inbox
position: 3072
completed: false
completed_at: null
due_at: 2026-07-23T00:00:00Z
tag_ids: []
checklist_ids: []
comment_ids: []
created_at: ${timestamp}
updated_at: ${timestamp}
archived_at: null
---

Earlier.
`,
    );
    await writeFile(
      join(root, "rules/rule_scheduled_sort.yaml"),
      `schema_version: 1
id: rule_scheduled_sort
name: Sort cards
enabled: true
trigger: { type: schedule, cron: "0 8 * * *", timezone: Europe/Amsterdam }
actions:
  - { type: sort_cards, scope: all_columns, by: due_at, direction: ascending, nulls: last }
created_at: ${timestamp}
updated_at: ${timestamp}
`,
    );

    assert.equal(
      await runScheduledRule(root, "rule_scheduled_sort", new Date("2026-07-22T10:00:00Z")),
      1,
    );
    const board = await import("../src/lib/workspace/board-repository.ts").then(
      ({ readWorkspaceBoard }) => readWorkspaceBoard(root),
    );
    assert.deepEqual(board.columns.find((column) => column.id === "column_inbox")?.cardIds, [
      "card_earlier",
      "card_test",
      "card_undated",
    ]);

    const sources = await Promise.all(
      ["card_earlier", "card_test", "card_undated"].map((id) =>
        readFile(join(root, `cards/${id}.md`), "utf8"),
      ),
    );
    assert.equal(
      await runScheduledRule(root, "rule_scheduled_sort", new Date("2026-07-22T10:01:00Z")),
      0,
    );
    assert.deepEqual(
      await Promise.all(
        ["card_earlier", "card_test", "card_undated"].map((id) =>
          readFile(join(root, `cards/${id}.md`), "utf8"),
        ),
      ),
      sources,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("scheduled changes cascade through ordinary event rules in the same transaction", async () => {
  const root = await makeDateWorkspace("2026-07-24T00:00:00Z");
  try {
    const timestamp = "2026-07-20T10:00:00Z";
    await writeFile(
      join(root, "rules/rule_none_to_planned.yaml"),
      `schema_version: 1
id: rule_none_to_planned
name: Route undated cards
enabled: true
trigger: { type: due_state_changed }
conditions: [{ type: due_state, value: none }]
actions: [{ type: move_card, column_id: column_planned }]
created_at: ${timestamp}
updated_at: ${timestamp}
`,
    );
    await writeFile(
      join(root, "rules/rule_scheduled_clear.yaml"),
      `schema_version: 1
id: rule_scheduled_clear
name: Clear dates
enabled: true
trigger: { type: schedule, cron: "0 8 * * *", timezone: Europe/Amsterdam }
actions: [{ type: clear_due_date }]
created_at: ${timestamp}
updated_at: ${timestamp}
`,
    );

    assert.equal(
      await runScheduledRule(root, "rule_scheduled_clear", new Date("2026-07-22T10:00:00Z")),
      1,
    );
    const board = await import("../src/lib/workspace/board-repository.ts").then(
      ({ readWorkspaceBoard }) => readWorkspaceBoard(root),
    );
    assert.equal(board.cards.card_test.dueDate, null);
    assert.deepEqual(board.columns.find((column) => column.id === "column_planned")?.cardIds, [
      "card_test",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
