import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse, stringify } from "yaml";

import { createRuleId, type Rule } from "../src/lib/rule-model.ts";
import { initializeWorkspace } from "../src/lib/workspace/initializer.ts";
import { readWorkspaceRules, writeWorkspaceRules } from "../src/lib/workspace/rules-repository.ts";
import { validateWorkspace } from "../src/lib/workspace/validator.ts";

const firstWrite = new Date("2026-07-21T10:00:00Z");
const secondWrite = new Date("2026-07-21T11:00:00Z");

async function makeWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "flowmark-rules-"));
  await initializeWorkspace(root);
  await writeFile(
    join(root, "tags/tag_work.yaml"),
    `schema_version: 1
id: tag_work
name: Work
color: blue
description: null
created_at: 2026-07-21T09:00:00Z
updated_at: 2026-07-21T09:00:00Z
`,
  );
  return root;
}

function rule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: "rule_test",
    name: "Test rule",
    enabled: true,
    trigger: { kind: "card.created", columnId: "column_inbox" },
    actions: [{ kind: "addTag", tagId: "tag_work" }],
    ...overrides,
  };
}

async function addDoneColumn(root: string) {
  const timestamp = "2026-07-21T09:00:00Z";
  await writeFile(
    join(root, "columns/column_done.yaml"),
    `schema_version: 1
id: column_done
name: Done
position: 2048
color: neutral
created_at: ${timestamp}
updated_at: ${timestamp}
`,
  );
  const workspacePath = join(root, "flowmark.yaml");
  const workspace = parse(await readFile(workspacePath, "utf8"));
  workspace.ui.column_order.push("column_done");
  await writeFile(workspacePath, stringify(workspace));
}

test("new rule IDs satisfy the canonical resource format", () => {
  assert.match(createRuleId(), /^rule_[a-z0-9]{12}$/);
});

test("column-created and due-state rules round-trip without changing meaning", async () => {
  const root = await makeWorkspace();
  try {
    const rules = [
      rule(),
      rule({
        id: "rule_due_today",
        name: "Due today",
        trigger: { kind: "card.dueOn", when: "today" },
        actions: [{ kind: "setDueDate", offsetDays: 1 }],
      }),
    ];

    await writeWorkspaceRules(root, { rules, deletedIds: [] }, firstWrite);

    const createdSource = parse(await readFile(join(root, "rules/rule_test.yaml"), "utf8"));
    assert.deepEqual(createdSource.trigger, { type: "card_created" });
    assert.deepEqual(createdSource.conditions, [{ type: "column", column_id: "column_inbox" }]);
    const dueSource = parse(await readFile(join(root, "rules/rule_due_today.yaml"), "utf8"));
    assert.deepEqual(dueSource.trigger, { type: "due_date_reached" });
    assert.deepEqual(dueSource.conditions, [{ type: "due_state", value: "today" }]);

    assert.deepEqual(
      (await readWorkspaceRules(root)).rules.toSorted((left, right) =>
        left.id.localeCompare(right.id),
      ),
      rules.toSorted((left, right) => left.id.localeCompare(right.id)),
    );
    assert.deepEqual((await validateWorkspace(root, { strict: true })).errors, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("every visual trigger and action round-trips through canonical YAML", async () => {
  const root = await makeWorkspace();
  try {
    await addDoneColumn(root);
    const triggers: Array<[string, Rule["trigger"]]> = [
      ["created_any", { kind: "card.created", columnId: "*" }],
      ["created_column", { kind: "card.created", columnId: "column_inbox" }],
      ["moved", { kind: "card.moved", toColumnId: "column_inbox" }],
      ["completed", { kind: "card.completed", value: true }],
      ["reopened", { kind: "card.completed", value: false }],
      ["due_today", { kind: "card.dueOn", when: "today" }],
      ["due_tomorrow", { kind: "card.dueOn", when: "tomorrow" }],
      ["due_overdue", { kind: "card.dueOn", when: "overdue" }],
    ];
    const actions: Rule["actions"] = [
      { kind: "setDueDate", offsetDays: 7 },
      { kind: "clearDueDate" },
      { kind: "addTag", tagId: "tag_work" },
      { kind: "removeTag", tagId: "tag_work" },
      { kind: "moveToColumn", columnId: "column_done" },
      { kind: "setCompleted", value: true },
      { kind: "setCompleted", value: false },
    ];
    const rules = triggers.map(([suffix, trigger]) =>
      rule({
        id: `rule_${suffix}`,
        name: suffix,
        trigger,
        actions: structuredClone(actions),
      }),
    );

    await writeWorkspaceRules(root, { rules, deletedIds: [] }, firstWrite);
    const loaded = await readWorkspaceRules(root);

    assert.equal(loaded.timeZone, Intl.DateTimeFormat().resolvedOptions().timeZone);
    assert.deepEqual(
      loaded.rules.toSorted((left, right) => left.id.localeCompare(right.id)),
      rules.toSorted((left, right) => left.id.localeCompare(right.id)),
    );
    assert.deepEqual((await validateWorkspace(root, { strict: true })).errors, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("due-state conditions and stable sorting round-trip through canonical YAML", async () => {
  const root = await makeWorkspace();
  try {
    await addDoneColumn(root);
    const dateDriven = rule({
      id: "rule_route_future",
      name: "Route future cards",
      trigger: { kind: "card.dueStateChanged" },
      conditions: [
        { kind: "completed", value: false },
        { kind: "dueState", value: "future" },
        { kind: "column", operator: "not_in", columnIds: ["column_done"] },
      ],
      actions: [{ kind: "moveToColumn", columnId: "column_inbox" }, { kind: "sortByDueDate" }],
    });

    await writeWorkspaceRules(root, { rules: [dateDriven], deletedIds: [] }, firstWrite);

    const source = parse(await readFile(join(root, "rules/rule_route_future.yaml"), "utf8"));
    assert.deepEqual(source.trigger, { type: "due_state_changed" });
    assert.deepEqual(source.conditions, [
      { type: "completed", value: false },
      { type: "due_state", value: "future" },
      { type: "column", operator: "not_in", column_ids: ["column_done"] },
    ]);
    assert.deepEqual(source.actions.at(-1), {
      type: "sort_cards",
      scope: "all_columns",
      by: "due_at",
      direction: "ascending",
      nulls: "last",
    });
    assert.deepEqual((await readWorkspaceRules(root)).rules, [dateDriven]);
    assert.deepEqual((await validateWorkspace(root, { strict: true })).errors, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("event age conditions and archive actions round-trip through canonical YAML", async () => {
  const root = await makeWorkspace();
  try {
    const archiveRule = rule({
      id: "rule_archive_old",
      name: "Archive old completed cards",
      trigger: { kind: "card.completed", value: true },
      conditions: [
        { kind: "createdAgeDays", value: 20 },
        { kind: "completedAgeDays", value: 30 },
      ],
      actions: [{ kind: "archiveCard" }],
    });

    await writeWorkspaceRules(root, {
      rules: [archiveRule],
      deletedIds: [],
    });

    const source = parse(await readFile(join(root, "rules/rule_archive_old.yaml"), "utf8"));
    assert.deepEqual(source.conditions, [
      {
        type: "created_age_days",
        operator: "greater_than_or_equal",
        value: 20,
      },
      {
        type: "completed_age_days",
        operator: "greater_than_or_equal",
        value: 30,
      },
    ]);
    assert.deepEqual(source.actions, [{ type: "archive_card" }]);
    assert.deepEqual((await readWorkspaceRules(root)).rules, [archiveRule]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("end-of-day due actions execute as today's date without rewriting unchanged YAML", async () => {
  const root = await makeWorkspace();
  try {
    const path = join(root, "rules/rule_end_of_day.yaml");
    await writeFile(
      path,
      `schema_version: 1
id: rule_end_of_day
name: Due today
enabled: true
trigger: { type: card_created }
actions: [{ type: set_due_date, mode: end_of_day }]
created_at: 2026-07-20T12:00:00Z
updated_at: 2026-07-20T12:00:00Z
`,
    );
    const before = await readFile(path, "utf8");
    const { rules } = await readWorkspaceRules(root);
    assert.deepEqual(rules.find((rule) => rule.id === "rule_end_of_day")?.actions, [
      { kind: "setDueDate", offsetDays: 0 },
    ]);
    await writeWorkspaceRules(root, { rules, deletedIds: [] });
    assert.equal(await readFile(path, "utf8"), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unchanged rules keep timestamps and hidden manual rules are preserved", async () => {
  const root = await makeWorkspace();
  try {
    const visible = rule();
    await writeWorkspaceRules(root, { rules: [visible], deletedIds: [] }, firstWrite);
    const firstSource = await readFile(join(root, "rules/rule_test.yaml"), "utf8");

    await writeFile(
      join(root, "rules/rule_manual_schedule.yaml"),
      `schema_version: 1
id: rule_manual_schedule
name: Manual schedule
enabled: true
trigger:
  type: schedule
  cron: "0 8 * * *"
  timezone: Europe/Amsterdam
actions:
  - type: clear_due_date
created_at: 2026-07-21T09:00:00Z
updated_at: 2026-07-21T09:00:00Z
`,
    );

    await writeWorkspaceRules(root, { rules: [visible], deletedIds: [] }, secondWrite);

    assert.equal(await readFile(join(root, "rules/rule_test.yaml"), "utf8"), firstSource);
    assert.match(
      await readFile(join(root, "rules/rule_manual_schedule.yaml"), "utf8"),
      /Manual schedule/,
    );
    assert.deepEqual(
      (await readWorkspaceRules(root)).rules.map((candidate) => candidate.id),
      ["rule_test"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("explicit deletion removes only an editor-managed rule", async () => {
  const root = await makeWorkspace();
  try {
    await writeWorkspaceRules(root, { rules: [rule()], deletedIds: [] }, firstWrite);
    await writeWorkspaceRules(root, { rules: [], deletedIds: ["rule_test"] }, secondWrite);

    await assert.rejects(() => readFile(join(root, "rules/rule_test.yaml"), "utf8"));
    assert.deepEqual((await validateWorkspace(root, { strict: true })).errors, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rule writes preserve unrelated warning-level source fields", async () => {
  const root = await makeWorkspace();
  try {
    const tagPath = join(root, "tags/tag_work.yaml");
    await writeFile(tagPath, `${await readFile(tagPath, "utf8")}custom_note: keep me\n`);

    await writeWorkspaceRules(root, { rules: [rule()], deletedIds: [] }, firstWrite);

    assert.match(await readFile(tagPath, "utf8"), /custom_note: keep me/);
    assert.deepEqual((await validateWorkspace(root)).errors, []);
    assert.match(await readFile(join(root, "rules/rule_test.yaml"), "utf8"), /id: rule_test/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid UI rules fail before writing authoritative files", async () => {
  const root = await makeWorkspace();
  try {
    await assert.rejects(
      () =>
        writeWorkspaceRules(
          root,
          { rules: [rule({ id: "invalid", actions: [] })], deletedIds: [] },
          firstWrite,
        ),
      /Invalid rule ID/,
    );
    await assert.rejects(() => readFile(join(root, "rules/invalid.yaml"), "utf8"));

    await assert.rejects(
      () =>
        writeWorkspaceRules(
          root,
          {
            rules: [
              rule({
                id: "rule_self_loop",
                trigger: { kind: "card.moved", toColumnId: "column_inbox" },
                actions: [{ kind: "moveToColumn", columnId: "column_inbox" }],
              }),
            ],
            deletedIds: [],
          },
          firstWrite,
        ),
      /same column|self-trigger/i,
    );
    await assert.rejects(() => readFile(join(root, "rules/rule_self_loop.yaml"), "utf8"));
    assert.deepEqual((await validateWorkspace(root, { strict: true })).errors, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
