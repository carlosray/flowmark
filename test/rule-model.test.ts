import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  COLUMN_CONDITION_OPERATORS,
  DUE_STATES,
  RULE_ACTION_TYPES,
  RULE_CONDITION_TYPES,
  RULE_TRIGGER_TYPES,
} from "../src/lib/rule-model.ts";
import { initializeWorkspace } from "../src/lib/workspace/initializer.ts";
import { getComponentSchema } from "../src/lib/workspace/schema-catalog.ts";
import { validateWorkspace } from "../src/lib/workspace/validator.ts";

test("rule language exports the complete declarative vocabulary", () => {
  assert.deepEqual(RULE_TRIGGER_TYPES, [
    "card_created",
    "card_entered_column",
    "card_completed",
    "card_uncompleted",
    "due_date_reached",
    "due_state_changed",
    "schedule",
  ]);
  assert.deepEqual(RULE_CONDITION_TYPES, [
    "column",
    "tag",
    "completed",
    "due_state",
    "created_age_days",
    "completed_age_days",
  ]);
  assert.deepEqual(RULE_ACTION_TYPES, [
    "move_card",
    "set_due_date",
    "clear_due_date",
    "add_tag",
    "remove_tag",
    "mark_completed",
    "mark_uncompleted",
    "archive_card",
    "sort_cards",
  ]);
  assert.deepEqual(DUE_STATES, ["none", "overdue", "today", "tomorrow", "future"]);
  assert.deepEqual(COLUMN_CONDITION_OPERATORS, ["in", "not_in"]);
});

test("published rule schema contains every runtime vocabulary value", () => {
  const source = JSON.stringify(getComponentSchema("rule"));
  for (const value of [
    ...RULE_TRIGGER_TYPES,
    ...RULE_CONDITION_TYPES,
    ...RULE_ACTION_TYPES,
    ...DUE_STATES,
    ...COLUMN_CONDITION_OPERATORS,
  ]) {
    assert.match(source, new RegExp(`"${value}"`));
  }
});

test("strict validation accepts date-state conditions and stable all-column sorting", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-rule-language-"));
  try {
    await initializeWorkspace(root);
    await writeFile(
      join(root, "rules/rule_route_future.yaml"),
      `schema_version: 1
id: rule_route_future
name: Route future open cards
enabled: true
trigger:
  type: due_state_changed
conditions:
  - type: completed
    value: false
  - type: due_state
    value: future
  - type: column
    operator: not_in
    column_ids: [column_inbox]
actions:
  - type: move_card
    column_id: column_inbox
  - type: sort_cards
    scope: all_columns
    by: due_at
    direction: ascending
    nulls: last
created_at: 2026-07-22T12:00:00Z
updated_at: 2026-07-22T12:00:00Z
`,
    );

    assert.deepEqual((await validateWorkspace(root, { strict: true })).errors, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("strict validation rejects invalid new rule parameters", async () => {
  const cases = [
    ["due state", "  - type: due_state\n    value: someday", /due state/i],
    [
      "column operator",
      "  - type: column\n    operator: beside\n    column_ids: [column_inbox]",
      /operator/i,
    ],
    [
      "mixed column forms",
      "  - type: column\n    column_id: column_inbox\n    operator: in\n    column_ids: [column_inbox]",
      /either column_id or operator/i,
    ],
  ] as const;

  for (const [name, condition, message] of cases) {
    const root = await mkdtemp(
      join(tmpdir(), `flowmark-rule-invalid-${name.replaceAll(" ", "-")}-`),
    );
    try {
      await initializeWorkspace(root);
      await writeFile(
        join(root, "rules/rule_invalid.yaml"),
        `schema_version: 1
id: rule_invalid
name: Invalid rule
enabled: true
trigger: { type: due_state_changed }
conditions:
${condition}
actions:
  - type: clear_due_date
created_at: 2026-07-22T12:00:00Z
updated_at: 2026-07-22T12:00:00Z
`,
      );
      const result = await validateWorkspace(root, { strict: true });
      assert.ok(result.errors.length > 0, `${name} should fail`);
      assert.match(result.errors.map((error) => error.message).join("\n"), message);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("strict validation enforces nested trigger, condition, and action schemas", async () => {
  const cases = [
    {
      name: "trigger field",
      trigger: "{ type: due_state_changed, column_id: column_inbox }",
      conditions: "[]",
      actions: "[{ type: clear_due_date }]",
      field: "trigger.column_id",
    },
    {
      name: "missing moved column",
      trigger: "{ type: card_entered_column }",
      conditions: "[]",
      actions: "[{ type: clear_due_date }]",
      field: "trigger.column_id",
    },
    {
      name: "condition field",
      trigger: "{ type: due_state_changed }",
      conditions: "[{ type: completed, value: false, extra: true }]",
      actions: "[{ type: clear_due_date }]",
      field: "conditions[0].extra",
    },
    {
      name: "action field",
      trigger: "{ type: due_state_changed }",
      conditions: "[]",
      actions: "[{ type: clear_due_date, offset_days: 2 }]",
      field: "actions[0].offset_days",
    },
    {
      name: "missing tag",
      trigger: "{ type: due_state_changed }",
      conditions: "[]",
      actions: "[{ type: add_tag }]",
      field: "actions[0].tag_id",
    },
    {
      name: "invalid due mode",
      trigger: "{ type: due_state_changed }",
      conditions: "[]",
      actions: "[{ type: set_due_date, mode: someday, offset_days: 1 }]",
      field: "actions[0].mode",
    },
    {
      name: "missing due offset",
      trigger: "{ type: due_state_changed }",
      conditions: "[]",
      actions: "[{ type: set_due_date, mode: offset }]",
      field: "actions[0].offset_days",
    },
  ] as const;

  for (const item of cases) {
    const root = await mkdtemp(
      join(tmpdir(), `flowmark-rule-nested-${item.name.replaceAll(" ", "-")}-`),
    );
    try {
      await initializeWorkspace(root);
      await writeFile(
        join(root, "rules/rule_invalid.yaml"),
        `schema_version: 1
id: rule_invalid
name: Invalid nested rule
enabled: true
trigger: ${item.trigger}
conditions: ${item.conditions}
actions: ${item.actions}
created_at: 2026-07-22T12:00:00Z
updated_at: 2026-07-22T12:00:00Z
`,
      );
      const result = await validateWorkspace(root, { strict: true });
      assert.ok(
        result.errors.some((error) => error.fieldPath === item.field),
        `${item.name} should report ${item.field}: ${JSON.stringify(result.errors)}`,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});
