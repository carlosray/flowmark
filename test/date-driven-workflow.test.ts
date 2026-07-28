import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { applyRuleTransaction, type RuleEvent } from "../src/lib/rule-engine.ts";
import type { Rule } from "../src/lib/rule-model.ts";
import type { Board, Card } from "../src/lib/types.ts";
import { readWorkspaceRules } from "../src/lib/workspace/rules-repository.ts";
import { validateWorkspace } from "../src/lib/workspace/validator.ts";

const ROOT = fileURLToPath(new URL("fixtures/date-driven-workflow", import.meta.url));
const NOW = new Date("2026-07-22T10:00:00Z");
const COLUMN_IDS = [
  "column_today",
  "column_tomorrow",
  "column_planned",
  "column_to_plan",
  "column_done",
];

function card(id: string, overrides: Partial<Card> = {}): Card {
  return {
    id,
    title: id,
    description: "",
    dueDate: null,
    checklist: [],
    comments: [],
    tagIds: [],
    completed: false,
    completedAt: null,
    createdAt: "2026-07-20T10:00:00Z",
    updatedAt: "2026-07-20T10:00:00Z",
    ...overrides,
  };
}

function board(cards: Card[], placements: Partial<Record<string, string[]>>): Board {
  return {
    cards: Object.fromEntries(cards.map((item) => [item.id, item])),
    columns: COLUMN_IDS.map((id) => ({ id, name: id, cardIds: placements[id] ?? [] })),
    tags: [],
  };
}

function columnOf(board: Board, cardId: string) {
  return board.columns.find((column) => column.cardIds.includes(cardId))?.id;
}

function apply(source: Board, rules: Rule[], events: RuleEvent[], now = NOW) {
  const result = applyRuleTransaction({
    board: source,
    rules,
    events,
    now,
    timeZone: "Europe/Amsterdam",
  });
  assert.deepEqual(result.diagnostics, []);
  return result.board;
}

test("complete workflow fixture is strict-valid and entirely editor-readable", async () => {
  assert.deepEqual((await validateWorkspace(ROOT, { strict: true })).errors, []);
  const { rules } = await readWorkspaceRules(ROOT);
  assert.equal(rules.length, 14);
  assert.equal(
    rules.every((rule) => rule.enabled),
    true,
  );
});

test("creation in Today, Tomorrow, and undated Planned assigns the configured dates", async () => {
  const { rules } = await readWorkspaceRules(ROOT);
  for (const [columnId, expected] of [
    ["column_today", "2026-07-22"],
    ["column_tomorrow", "2026-07-23"],
    ["column_planned", "2026-08-01"],
  ] as const) {
    const source = board([card("card_test")], { [columnId]: ["card_test"] });
    const result = apply(source, rules, [{ kind: "card.created", cardId: "card_test", columnId }]);
    assert.equal(result.cards.card_test.dueDate, expected);
    assert.equal(columnOf(result, "card_test"), columnId);
  }
});

test("explicit moves set Today and Tomorrow dates while Planned preserves an existing date", async () => {
  const { rules } = await readWorkspaceRules(ROOT);
  for (const [toColumnId, initialDate, expectedDate] of [
    ["column_today", "2026-08-05", "2026-07-22"],
    ["column_tomorrow", null, "2026-07-23"],
    ["column_planned", "2026-08-05", "2026-08-05"],
    ["column_planned", null, "2026-08-01"],
  ] as const) {
    const source = board([card("card_test", { dueDate: initialDate })], {
      [toColumnId]: ["card_test"],
    });
    const result = apply(source, rules, [
      {
        kind: "card.moved",
        cardId: "card_test",
        fromColumnId: "column_to_plan",
        toColumnId,
      },
    ]);
    assert.equal(result.cards.card_test.dueDate, expectedDate);
    assert.equal(columnOf(result, "card_test"), toColumnId);
  }
});

test("due-date edits route open cards to Today, Tomorrow, Planned, or To Plan", async () => {
  const { rules } = await readWorkspaceRules(ROOT);
  for (const [dueDate, start, expected] of [
    ["2026-07-20", "column_planned", "column_today"],
    ["2026-07-22", "column_planned", "column_today"],
    ["2026-07-23", "column_today", "column_tomorrow"],
    ["2026-07-24", "column_today", "column_planned"],
    [null, "column_planned", "column_to_plan"],
  ] as const) {
    const source = board([card("card_test", { dueDate })], { [start]: ["card_test"] });
    const result = apply(source, rules, [{ kind: "card.dueStateChanged", cardId: "card_test" }]);
    assert.equal(columnOf(result, "card_test"), expected);
  }
});

test("completion wins and reopening routes from the card's current due state", async () => {
  const { rules } = await readWorkspaceRules(ROOT);
  const completed = apply(
    board([card("card_test", { completed: true, completedAt: NOW.toISOString() })], {
      column_today: ["card_test"],
    }),
    rules,
    [{ kind: "card.completed", cardId: "card_test", completed: true }],
  );
  assert.equal(columnOf(completed, "card_test"), "column_done");

  for (const [dueDate, expected] of [
    ["2026-07-22", "column_today"],
    ["2026-07-23", "column_tomorrow"],
    ["2026-07-24", "column_planned"],
    [null, "column_to_plan"],
  ] as const) {
    const reopened = apply(
      board([card("card_test", { dueDate, completed: false, completedAt: null })], {
        column_done: ["card_test"],
      }),
      rules,
      [{ kind: "card.completed", cardId: "card_test", completed: false }],
    );
    assert.equal(columnOf(reopened, "card_test"), expected);
  }
});

test("reconciliation catches missed date transitions using current local date", async () => {
  const { rules } = await readWorkspaceRules(ROOT);
  const source = board([card("card_test", { dueDate: "2026-07-23" })], {
    column_tomorrow: ["card_test"],
  });
  const result = apply(
    source,
    rules,
    [{ kind: "card.dueStateChanged", cardId: "card_test" }],
    new Date("2026-07-24T10:00:00Z"),
  );
  assert.equal(columnOf(result, "card_test"), "column_today");
});

test("all columns sort earlier dates first, preserve equal dates, and put null dates last", async () => {
  const { rules } = await readWorkspaceRules(ROOT);
  const cards = [
    card("card_null"),
    card("card_equal_a", { dueDate: "2026-07-25" }),
    card("card_late", { dueDate: "2026-08-01" }),
    card("card_equal_b", { dueDate: "2026-07-25" }),
    card("card_early", { dueDate: "2026-07-22" }),
  ];
  const source = board(cards, {
    column_today: ["card_null", "card_equal_a", "card_late", "card_equal_b", "card_early"],
  });
  const result = apply(
    source,
    rules,
    cards.map(({ id }) => ({ kind: "card.dueStateChanged" as const, cardId: id })),
  );
  assert.deepEqual(result.columns.find(({ id }) => id === "column_today")?.cardIds, ["card_early"]);
  assert.deepEqual(result.columns.find(({ id }) => id === "column_planned")?.cardIds, [
    "card_equal_a",
    "card_equal_b",
    "card_late",
  ]);
  assert.deepEqual(result.columns.find(({ id }) => id === "column_to_plan")?.cardIds, [
    "card_null",
  ]);
});
