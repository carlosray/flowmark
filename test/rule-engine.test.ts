import assert from "node:assert/strict";
import test from "node:test";

import { applyRuleTransaction, type RuleEvent } from "../src/lib/rule-engine.ts";
import type { DueState, Rule } from "../src/lib/rule-model.ts";
import type { Board, Card } from "../src/lib/types.ts";

const NOW = new Date("2026-07-22T10:00:00Z");
const TIME_ZONE = "Europe/Amsterdam";

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

function board(cards: Card[], placements: Record<string, string[]>): Board {
  return {
    cards: Object.fromEntries(cards.map((item) => [item.id, item])),
    columns: Object.entries(placements).map(([id, cardIds]) => ({ id, name: id, cardIds })),
    tags: [{ id: "tag_work", name: "Work", color: "blue" }],
  };
}

function rule(overrides: Partial<Rule>): Rule {
  return {
    id: "rule_test",
    name: "Test",
    enabled: true,
    trigger: { kind: "card.dueStateChanged" },
    conditions: [],
    actions: [{ kind: "clearDueDate" }],
    ...overrides,
  };
}

function run(source: Board, rules: Rule[], events: RuleEvent[]) {
  return applyRuleTransaction({ board: source, rules, events, now: NOW, timeZone: TIME_ZONE });
}

test("due-state conditions distinguish none, overdue, today, tomorrow, and future", () => {
  const cards = [
    card("card_none"),
    card("card_overdue", { dueDate: "2026-07-21" }),
    card("card_today", { dueDate: "2026-07-22" }),
    card("card_tomorrow", { dueDate: "2026-07-23" }),
    card("card_future", { dueDate: "2026-07-24" }),
  ];
  const source = board(cards, { column_source: cards.map(({ id }) => id), column_target: [] });

  for (const state of ["none", "overdue", "today", "tomorrow", "future"] as DueState[]) {
    const targetId = `card_${state}`;
    const result = run(
      source,
      [
        rule({
          id: `rule_${state}`,
          conditions: [{ kind: "dueState", value: state }],
          actions: [{ kind: "moveToColumn", columnId: "column_target" }],
        }),
      ],
      cards.map(({ id }) => ({ kind: "card.dueStateChanged", cardId: id })),
    );
    assert.deepEqual(result.board.columns[1].cardIds, [targetId]);
  }
});

test("event rules apply completed, tag, and in/not_in column conditions", () => {
  const source = board([card("card_test", { tagIds: ["tag_work"] })], {
    column_inbox: ["card_test"],
    column_done: [],
  });
  const result = run(
    source,
    [
      rule({
        id: "rule_conditions",
        trigger: { kind: "card.created", columnId: "*" },
        conditions: [
          { kind: "completed", value: false },
          { kind: "tag", tagId: "tag_work" },
          { kind: "column", operator: "in", columnIds: ["column_inbox"] },
          { kind: "column", operator: "not_in", columnIds: ["column_done"] },
        ],
        actions: [{ kind: "moveToColumn", columnId: "column_done" }],
      }),
    ],
    [{ kind: "card.created", cardId: "card_test", columnId: "column_inbox" }],
  );

  assert.deepEqual(result.board.columns[1].cardIds, ["card_test"]);
});

test("event rules apply age conditions and archive cards as source removals", () => {
  const source = board(
    [
      card("card_old", {
        completed: true,
        completedAt: "2026-07-20T10:00:00Z",
        createdAt: "2026-07-01T10:00:00Z",
      }),
      card("card_recent", {
        completed: true,
        completedAt: "2026-07-22T09:00:00Z",
        createdAt: "2026-07-21T10:00:00Z",
      }),
    ],
    { column_done: ["card_old", "card_recent"] },
  );
  const result = run(
    source,
    [
      rule({
        id: "rule_archive_old",
        trigger: { kind: "card.completed", value: true },
        conditions: [
          { kind: "createdAgeDays", value: 10 },
          { kind: "completedAgeDays", value: 2 },
        ],
        actions: [{ kind: "archiveCard" }],
      }),
    ],
    [
      { kind: "card.completed", cardId: "card_old", completed: true },
      { kind: "card.completed", cardId: "card_recent", completed: true },
    ],
  );

  assert.equal(result.board.cards.card_old, undefined);
  assert.ok(result.board.cards.card_recent);
  assert.deepEqual(result.board.columns[0].cardIds, ["card_recent"]);
  assert.equal(result.diagnostics.length, 0);
});

test("derived events cascade through due-date assignment and routing", () => {
  const source = board([card("card_test")], { column_planned: ["card_test"], column_other: [] });
  const result = run(
    source,
    [
      rule({
        id: "rule_assign_planned_date",
        trigger: { kind: "card.created", columnId: "*" },
        conditions: [
          { kind: "column", operator: "in", columnIds: ["column_planned"] },
          { kind: "dueState", value: "none" },
        ],
        actions: [{ kind: "setDueDate", offsetDays: 10 }],
      }),
      rule({
        id: "rule_route_future",
        conditions: [
          { kind: "completed", value: false },
          { kind: "dueState", value: "future" },
        ],
        actions: [{ kind: "moveToColumn", columnId: "column_planned" }],
      }),
    ],
    [{ kind: "card.created", cardId: "card_test", columnId: "column_planned" }],
  );

  assert.equal(result.board.cards.card_test.dueDate, "2026-08-01");
  assert.deepEqual(result.board.columns[0].cardIds, ["card_test"]);
  assert.equal(result.diagnostics.length, 0);
});

test("unchanged actions are no-ops and do not create derived event churn", () => {
  const source = board([card("card_test", { dueDate: "2026-07-22" })], {
    column_today: ["card_test"],
  });
  const result = run(
    source,
    [
      rule({
        id: "rule_already_today",
        conditions: [{ kind: "dueState", value: "today" }],
        actions: [
          { kind: "setDueDate", offsetDays: 0 },
          { kind: "moveToColumn", columnId: "column_today" },
        ],
      }),
    ],
    [{ kind: "card.dueStateChanged", cardId: "card_test" }],
  );

  assert.equal(result.changed, false);
  assert.strictEqual(result.board, source);
  assert.equal(result.operations, 0);
});

test("sorting is deferred, stable, all-column, and puts undated cards last", () => {
  const source = board(
    [
      card("card_null"),
      card("card_null_two"),
      card("card_late", { dueDate: "2026-08-01" }),
      card("card_equal_a", { dueDate: "2026-07-25" }),
      card("card_equal_b", { dueDate: "2026-07-25" }),
      card("card_early", { dueDate: "2026-07-20" }),
    ],
    {
      column_one: ["card_null", "card_equal_a", "card_early", "card_equal_b"],
      column_two: ["card_late", "card_null_two"],
    },
  );
  const result = run(
    source,
    [
      rule({
        id: "rule_sort",
        actions: [{ kind: "sortByDueDate" }],
      }),
    ],
    [{ kind: "card.dueStateChanged", cardId: "card_equal_a" }],
  );

  assert.deepEqual(result.board.columns[0].cardIds, [
    "card_early",
    "card_equal_a",
    "card_equal_b",
    "card_null",
  ]);
  assert.deepEqual(result.board.columns[1].cardIds, ["card_late", "card_null_two"]);
});

test("changing rule cycles terminate with an actionable diagnostic", () => {
  const source = board([card("card_test")], { column_a: [], column_b: ["card_test"] });
  const result = run(
    source,
    [
      rule({
        id: "rule_move_a",
        trigger: { kind: "card.moved", toColumnId: "column_b" },
        actions: [{ kind: "moveToColumn", columnId: "column_a" }],
      }),
      rule({
        id: "rule_move_b",
        trigger: { kind: "card.moved", toColumnId: "column_a" },
        actions: [{ kind: "moveToColumn", columnId: "column_b" }],
      }),
    ],
    [{ kind: "card.moved", cardId: "card_test", fromColumnId: "column_a", toColumnId: "column_b" }],
  );

  assert.match(result.diagnostics.map(({ code }) => code).join("\n"), /E_RULE_CYCLE/);
  assert.ok(result.operations < 100);
});

test("the default transaction budget scales with large reconciliation batches", () => {
  const cards = Array.from({ length: 400 }, (_, index) => card(`card_${index}`));
  const source = board(cards, { column_inbox: cards.map(({ id }) => id) });
  const events = cards.flatMap(({ id }) => [
    { kind: "card.completed" as const, cardId: id, completed: false },
    { kind: "card.dueStateChanged" as const, cardId: id },
  ]);

  const result = run(source, [], events);

  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.changed, false);
});
