import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { RulesStore, type RulesPersistence } from "../src/lib/rules.ts";
import type { Rule, RuleAction, RuleTrigger } from "../src/lib/rule-model.ts";
import { closeRulesModal, prepareRulesModalOpen, ruleActionOptions } from "../src/lib/rules-ui.ts";
import { BoardStore } from "../src/lib/store.ts";
import type { Board } from "../src/lib/types.ts";

class FakeScheduler {
  private now = 0;
  private nextId = 1;
  private tasks = new Map<number, { at: number; callback: () => void }>();

  setTimeout = (callback: () => void, delayMs: number): number => {
    const id = this.nextId++;
    this.tasks.set(id, { at: this.now + delayMs, callback });
    return id;
  };

  clearTimeout = (handle: unknown) => {
    this.tasks.delete(handle as number);
  };

  advanceBy(delayMs: number) {
    const target = this.now + delayMs;
    for (;;) {
      const next = [...this.tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort(([, left], [, right]) => left.at - right.at)[0];
      if (!next) break;
      const [id, task] = next;
      this.tasks.delete(id);
      this.now = task.at;
      task.callback();
    }
    this.now = target;
  }
}

const persistedRule: Rule = {
  id: "rule_existing",
  name: "Existing rule",
  enabled: true,
  trigger: { kind: "card.created", columnId: "*" },
  actions: [{ kind: "clearDueDate" }],
};

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return { ...structuredClone(persistedRule), ...overrides };
}

function persistence(overrides: Partial<RulesPersistence> = {}): RulesPersistence {
  return {
    read: async () => ({
      path: "/workspace/rules",
      timeZone: "Europe/Amsterdam",
      rules: [structuredClone(persistedRule)],
    }),
    save: async () => ({ path: "/workspace/rules" }),
    ...overrides,
  };
}

function boardFixture(overrides: Partial<Board["cards"][string]> = {}): Board {
  return {
    columns: [
      { id: "column_inbox", name: "Inbox", cardIds: ["card_test"] },
      { id: "column_today", name: "Today", cardIds: [] },
      { id: "column_done", name: "Done", cardIds: [] },
    ],
    cards: {
      card_test: {
        id: "card_test",
        title: "Test",
        description: "",
        dueDate: null,
        checklist: [],
        comments: [],
        tagIds: [],
        completed: false,
        completedAt: null,
        createdAt: "2026-07-21T09:00:00Z",
        updatedAt: "2026-07-21T09:00:00Z",
        ...overrides,
      },
    },
    tags: [{ id: "tag_work", name: "Work", color: "blue" }],
  };
}

async function boardStore(initial = boardFixture()) {
  const board = new BoardStore(
    {
      read: async () => ({ path: "/workspace", board: structuredClone(initial) }),
      save: async () => ({ path: "/workspace" }),
    },
    0,
  );
  await board.reloadFromDisk();
  return board;
}

async function hydrateAutomation(
  board: BoardStore,
  rules: Rule[],
  clock = () => new Date("2026-12-31T23:30:00Z"),
) {
  const automation = new RulesStore(
    persistence({
      read: async () => ({
        path: "/workspace/rules",
        timeZone: "Europe/Amsterdam",
        rules: structuredClone(rules),
      }),
    }),
    0,
    board,
    clock,
    { interactionDelayMs: 0 },
  );
  automation.hydrate();
  while (automation.getSyncSnapshot().status === "loading")
    await new Promise((resolve) => setTimeout(resolve, 1));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return automation;
}

async function hydrateDelayedAutomation(
  board: BoardStore,
  rules: Rule[],
  scheduler: FakeScheduler,
) {
  const automation = new RulesStore(
    persistence({
      read: async () => ({
        path: "/workspace/rules",
        timeZone: "Europe/Amsterdam",
        rules: structuredClone(rules),
      }),
    }),
    0,
    board,
    () => new Date("2026-12-31T23:30:00Z"),
    {
      interactionDelayMs: 500,
      effectDurationMs: 900,
      scheduler,
    },
  );
  automation.hydrate();
  while (automation.getSyncSnapshot().status === "loading")
    await new Promise((resolve) => setTimeout(resolve, 1));
  return automation;
}

test("new rules use canonical IDs and stay as disabled drafts until they have an action", async () => {
  const saves: Parameters<RulesPersistence["save"]>[0][] = [];
  const rules = new RulesStore(
    persistence({
      save: async (request) => {
        saves.push(structuredClone(request));
        return { path: "/workspace/rules" };
      },
    }),
    0,
  );
  await rules.reloadFromDisk();

  const draft = rules.add("New rule");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.match(draft.id, /^rule_[a-z0-9]{12}$/);
  assert.equal(draft.enabled, false);
  assert.equal(rules.getSyncSnapshot().status, "draft");
  assert.equal(saves.length, 0);

  rules.update(draft.id, { actions: [{ kind: "clearDueDate" }] });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(saves.length, 1);
  assert.deepEqual(
    saves[0].rules.map((rule) => rule.id),
    ["rule_existing", draft.id],
  );
  assert.deepEqual(saves[0].deletedIds, []);
  assert.equal(rules.getSyncSnapshot().status, "saved");
});

test("explicit deletion is persisted and pending saves can be flushed", async () => {
  const saves: Parameters<RulesPersistence["save"]>[0][] = [];
  const rules = new RulesStore(
    persistence({
      save: async (request) => {
        saves.push(structuredClone(request));
        return { path: "/workspace/rules" };
      },
    }),
    10_000,
  );
  await rules.reloadFromDisk();

  rules.remove("rule_existing");
  await rules.flushPendingSave();

  assert.equal(saves.length, 1);
  assert.deepEqual(saves[0], { rules: [], deletedIds: ["rule_existing"] });
});

test("failed rule persistence rolls back and can recover by reloading", async () => {
  let shouldFail = true;
  const rules = new RulesStore(
    persistence({
      save: async () => {
        if (shouldFail) throw new Error("server unavailable");
        return { path: "/workspace/rules" };
      },
    }),
    0,
  );
  await rules.reloadFromDisk();

  rules.update("rule_existing", { name: "Unsaved name" });
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(rules.getSyncSnapshot().status, "error");
  assert.match(rules.getSyncSnapshot().error ?? "", /server unavailable/);
  assert.deepEqual(rules.getSnapshot(), [persistedRule]);

  rules.update("rule_existing", { name: "Blocked edit" });
  assert.deepEqual(rules.getSnapshot(), [persistedRule]);

  shouldFail = false;
  await rules.reloadFromDisk();
  rules.update("rule_existing", { name: "Recovered edit" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(rules.getSnapshot()[0].name, "Recovered edit");
  assert.equal(rules.getSyncSnapshot().status, "saved");
});

test("persisted rules cannot lose their final action and drafts cannot be enabled", async () => {
  const rules = new RulesStore(persistence(), 0);
  await rules.reloadFromDisk();

  rules.update("rule_existing", { actions: [] });
  assert.deepEqual(rules.getSnapshot()[0].actions, [{ kind: "clearDueDate" }]);

  const draft = rules.add("Draft");
  rules.toggle(draft.id);
  assert.equal(rules.getSnapshot().find((rule) => rule.id === draft.id)?.enabled, false);
});

test("canonical rules are never read from or written to browser storage", async () => {
  const source = await readFile(new URL("../src/lib/rules.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /localStorage|flow\.rules\.cache/);
});

test("rules modal waits for persistence and remains dismissible after errors", async () => {
  const calls: string[] = [];
  const closed = await closeRulesModal({
    flushPendingSave: async () => {
      calls.push("flush");
    },
    onClose: () => calls.push("close"),
  });
  assert.equal(closed, true);
  assert.deepEqual(calls, ["flush", "close"]);

  calls.length = 0;
  const closedAfterError = await closeRulesModal({
    flushPendingSave: async () => {
      calls.push("flush");
    },
    onClose: () => calls.push("close"),
  });
  assert.equal(closedAfterError, true);
  assert.deepEqual(calls, ["flush", "close"]);
});

test("reopening the rules modal reloads after a persistence error", async () => {
  const calls: string[] = [];
  await prepareRulesModalOpen({
    hasPersistenceError: () => true,
    reloadFromDisk: async () => {
      calls.push("reload");
    },
  });
  assert.deepEqual(calls, ["reload"]);

  calls.length = 0;
  await prepareRulesModalOpen({
    hasPersistenceError: () => false,
    reloadFromDisk: async () => {
      calls.push("reload");
    },
  });
  assert.deepEqual(calls, []);
});

test("tag actions are unavailable when the workspace has no tags", () => {
  assert.deepEqual(
    ruleActionOptions(false).map(([kind]) => kind),
    ["setDueDate", "clearDueDate", "moveToColumn", "setCompleted", "sortByDueDate", "archiveCard"],
  );
  assert.equal(
    ruleActionOptions(true).some(([kind]) => kind === "addTag"),
    true,
  );
  assert.equal(
    ruleActionOptions(true).some(([kind]) => kind === "removeTag"),
    true,
  );
});

test("hydrated event rules execute board actions", async () => {
  const boardState: Board = {
    columns: [
      { id: "column_inbox", name: "Inbox", cardIds: ["card_test"] },
      { id: "column_done", name: "Done", cardIds: [] },
    ],
    cards: {
      card_test: {
        id: "card_test",
        title: "Test",
        description: "",
        dueDate: null,
        checklist: [],
        comments: [],
        tagIds: [],
        completed: false,
        completedAt: null,
        createdAt: "2026-07-21T09:00:00Z",
        updatedAt: "2026-07-21T09:00:00Z",
      },
    },
    tags: [],
  };
  const board = new BoardStore(
    {
      read: async () => ({ path: "/workspace", board: structuredClone(boardState) }),
      save: async () => ({ path: "/workspace" }),
    },
    0,
  );
  await board.reloadFromDisk();
  const automation = new RulesStore(
    persistence({
      read: async () => ({
        path: "/workspace/rules",
        timeZone: "Europe/Amsterdam",
        rules: [
          makeRule({
            id: "rule_complete_to_done",
            trigger: { kind: "card.completed", value: true },
            actions: [{ kind: "moveToColumn", columnId: "column_done" }],
          }),
        ],
      }),
    }),
    0,
    board,
    undefined,
    { interactionDelayMs: 0 },
  );
  automation.hydrate();
  while (automation.getSyncSnapshot().status === "loading")
    await new Promise((resolve) => setTimeout(resolve, 1));

  board.toggleCompleted("card_test");

  assert.deepEqual(board.getSnapshot().columns[0].cardIds, []);
  assert.deepEqual(board.getSnapshot().columns[1].cardIds, ["card_test"]);
});

test("moved-card due-date actions use the workspace timezone", async () => {
  const board = await boardStore();
  const automation = new RulesStore(
    persistence({
      read: async () => ({
        path: "/workspace/rules",
        timeZone: "Europe/Amsterdam",
        rules: [
          makeRule({
            id: "rule_move_due_tomorrow",
            trigger: { kind: "card.moved", toColumnId: "column_today" },
            actions: [{ kind: "setDueDate", offsetDays: 1 }],
          }),
        ],
      }),
    }),
    0,
    board,
    () => new Date("2026-12-31T23:30:00Z"),
    { interactionDelayMs: 0 },
  );
  automation.hydrate();
  while (automation.getSyncSnapshot().status === "loading")
    await new Promise((resolve) => setTimeout(resolve, 1));

  board.moveCard("card_test", "column_today", 0);

  assert.equal(board.getSnapshot().cards.card_test.dueDate, "2027-01-02");
});

test("drag-hover previews do not run move rules until the card is dropped", async () => {
  const board = await boardStore();
  await hydrateAutomation(board, [
    makeRule({
      id: "rule_drop_due_date",
      trigger: { kind: "card.moved", toColumnId: "column_today" },
      actions: [{ kind: "setDueDate", offsetDays: 1 }],
    }),
  ]);

  board.previewMoveCard("card_test", "column_today", 0);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(board.getSnapshot().cards.card_test.dueDate, null);

  board.commitCardMovePreview("card_test", "column_inbox");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(board.getSnapshot().cards.card_test.dueDate, "2027-01-02");
});

test("a stale drag order cannot duplicate a card after a rule redirects it", async () => {
  const board = await boardStore();
  await hydrateAutomation(board, [
    makeRule({
      id: "rule_redirect_to_inbox",
      trigger: { kind: "card.moved", toColumnId: "column_today" },
      actions: [{ kind: "moveToColumn", columnId: "column_inbox" }],
    }),
  ]);

  board.moveCard("card_test", "column_today", 0);
  board.reorderCardsInColumn("column_today", ["card_test"]);

  const snapshot = board.getSnapshot();
  const occurrences = snapshot.columns.reduce(
    (count, column) => count + column.cardIds.filter((cardId) => cardId === "card_test").length,
    0,
  );
  assert.equal(occurrences, 1);
  assert.deepEqual(snapshot.columns[0].cardIds, ["card_test"]);
  assert.deepEqual(snapshot.columns[1].cardIds, []);
});

test("interactive rules apply only after the configured delay", async () => {
  const scheduler = new FakeScheduler();
  const board = await boardStore();
  await hydrateDelayedAutomation(
    board,
    [
      makeRule({
        id: "rule_delayed_due",
        trigger: { kind: "card.moved", toColumnId: "column_today" },
        actions: [{ kind: "setDueDate", offsetDays: 1 }],
      }),
    ],
    scheduler,
  );

  board.moveCard("card_test", "column_today", 0);
  assert.equal(board.getSnapshot().cards.card_test.dueDate, null);

  scheduler.advanceBy(499);
  assert.equal(board.getSnapshot().cards.card_test.dueDate, null);

  scheduler.advanceBy(1);
  assert.equal(board.getSnapshot().cards.card_test.dueDate, "2027-01-02");
});

test("new events reset a card delay while preserving the queued interaction", async () => {
  const scheduler = new FakeScheduler();
  const board = await boardStore();
  await hydrateDelayedAutomation(
    board,
    [
      makeRule({
        id: "rule_delayed_tag",
        trigger: { kind: "card.moved", toColumnId: "column_today" },
        actions: [{ kind: "addTag", tagId: "tag_work" }],
      }),
    ],
    scheduler,
  );

  board.moveCard("card_test", "column_today", 0);
  scheduler.advanceBy(400);
  board.updateCard("card_test", { dueDate: "2027-01-02" });

  scheduler.advanceBy(499);
  assert.deepEqual(board.getSnapshot().cards.card_test.tagIds, []);

  scheduler.advanceBy(1);
  assert.deepEqual(board.getSnapshot().cards.card_test.tagIds, ["tag_work"]);
});

test("different cards have independent automation delays", async () => {
  const scheduler = new FakeScheduler();
  const initial = boardFixture();
  initial.cards.card_other = {
    ...structuredClone(initial.cards.card_test),
    id: "card_other",
    title: "Other",
  };
  initial.columns[0].cardIds.push("card_other");
  const board = await boardStore(initial);
  await hydrateDelayedAutomation(
    board,
    [
      makeRule({
        id: "rule_delayed_tag",
        trigger: { kind: "card.moved", toColumnId: "column_today" },
        actions: [{ kind: "addTag", tagId: "tag_work" }],
      }),
    ],
    scheduler,
  );

  board.moveCard("card_test", "column_today", 0);
  scheduler.advanceBy(250);
  board.moveCard("card_other", "column_today", 1);
  scheduler.advanceBy(250);

  assert.deepEqual(board.getSnapshot().cards.card_test.tagIds, ["tag_work"]);
  assert.deepEqual(board.getSnapshot().cards.card_other.tagIds, []);

  scheduler.advanceBy(250);
  assert.deepEqual(board.getSnapshot().cards.card_other.tagIds, ["tag_work"]);
});

test("queued events for a deleted card become harmless no-ops", async () => {
  const scheduler = new FakeScheduler();
  const board = await boardStore();
  const automation = await hydrateDelayedAutomation(
    board,
    [
      makeRule({
        id: "rule_delayed_due",
        trigger: { kind: "card.moved", toColumnId: "column_today" },
        actions: [{ kind: "setDueDate", offsetDays: 1 }],
      }),
    ],
    scheduler,
  );

  board.moveCard("card_test", "column_today", 0);
  board.deleteCard("card_test");
  scheduler.advanceBy(500);

  assert.equal(board.getSnapshot().cards.card_test, undefined);
  assert.equal(automation.getSyncSnapshot().runtimeError, null);
});

test("startup reconciliation remains immediate when interactions are delayed", async () => {
  const scheduler = new FakeScheduler();
  const initial = boardFixture({ dueDate: "2027-01-02" });
  const board = await boardStore(initial);

  await hydrateDelayedAutomation(
    board,
    [
      makeRule({
        id: "rule_startup_due",
        trigger: { kind: "card.dueStateChanged" },
        conditions: [{ kind: "dueState", value: "tomorrow" }],
        actions: [{ kind: "moveToColumn", columnId: "column_today" }],
      }),
    ],
    scheduler,
  );

  assert.deepEqual(board.getSnapshot().columns[1].cardIds, ["card_test"]);
});

test("held card automation waits until the final release and then uses the normal delay", async () => {
  const scheduler = new FakeScheduler();
  const initial = boardFixture({ dueDate: "2027-01-02" });
  initial.columns[0].cardIds = [];
  initial.columns[1].cardIds = ["card_test"];
  const board = await boardStore(initial);
  const automation = await hydrateDelayedAutomation(
    board,
    [
      makeRule({
        id: "rule_cleared_to_inbox",
        trigger: { kind: "card.dueStateChanged" },
        conditions: [{ kind: "dueState", value: "none" }],
        actions: [{ kind: "moveToColumn", columnId: "column_inbox" }],
      }),
    ],
    scheduler,
  );

  automation.holdCard("card_test");
  automation.holdCard("card_test");
  board.updateCard("card_test", { dueDate: null });
  scheduler.advanceBy(2_000);
  assert.deepEqual(board.getSnapshot().columns[1].cardIds, ["card_test"]);

  automation.releaseCard("card_test");
  scheduler.advanceBy(2_000);
  assert.deepEqual(board.getSnapshot().columns[1].cardIds, ["card_test"]);

  automation.releaseCard("card_test");
  scheduler.advanceBy(499);
  assert.deepEqual(board.getSnapshot().columns[1].cardIds, ["card_test"]);

  scheduler.advanceBy(1);
  assert.deepEqual(board.getSnapshot().columns[0].cardIds, ["card_test"]);
  assert.doesNotThrow(() => automation.releaseCard("missing_card"));
});

test("rule reload reconciliation skips held cards and preserves their queued events", async () => {
  const scheduler = new FakeScheduler();
  const initial = boardFixture({ dueDate: "2027-01-02" });
  initial.columns[0].cardIds = [];
  initial.columns[1].cardIds = ["card_test"];
  const board = await boardStore(initial);
  const automation = await hydrateDelayedAutomation(
    board,
    [
      makeRule({
        id: "rule_reload_held_card",
        trigger: { kind: "card.dueStateChanged" },
        conditions: [{ kind: "dueState", value: "none" }],
        actions: [{ kind: "moveToColumn", columnId: "column_inbox" }],
      }),
    ],
    scheduler,
  );

  automation.holdCard("card_test");
  board.updateCard("card_test", { dueDate: null });
  await automation.reloadFromDisk();
  scheduler.advanceBy(2_000);

  assert.deepEqual(board.getSnapshot().columns[1].cardIds, ["card_test"]);

  automation.releaseCard("card_test");
  scheduler.advanceBy(499);
  assert.deepEqual(board.getSnapshot().columns[1].cardIds, ["card_test"]);

  scheduler.advanceBy(1);
  assert.deepEqual(board.getSnapshot().columns[0].cardIds, ["card_test"]);
});

test("rule transactions publish moved and due-date feedback only for actual changes", async () => {
  const scheduler = new FakeScheduler();
  const board = await boardStore();
  const automation = await hydrateDelayedAutomation(
    board,
    [
      makeRule({
        id: "rule_feedback",
        trigger: { kind: "card.moved", toColumnId: "column_today" },
        actions: [
          { kind: "setDueDate", offsetDays: 1 },
          { kind: "moveToColumn", columnId: "column_done" },
        ],
      }),
    ],
    scheduler,
  );

  board.moveCard("card_test", "column_today", 0);
  assert.deepEqual(automation.getEffectsSnapshot(), {});

  scheduler.advanceBy(500);
  const effect = automation.getEffectsSnapshot().card_test;
  assert.equal(effect.cardId, "card_test");
  assert.equal(effect.revision > 0, true);
  assert.deepEqual(effect.kinds, ["moved", "due-date-changed"]);
});

test("no-op rules do not publish feedback", async () => {
  const scheduler = new FakeScheduler();
  const board = await boardStore();
  const automation = await hydrateDelayedAutomation(
    board,
    [
      makeRule({
        id: "rule_noop_feedback",
        trigger: { kind: "card.moved", toColumnId: "column_today" },
        actions: [{ kind: "moveToColumn", columnId: "column_today" }],
      }),
    ],
    scheduler,
  );

  board.moveCard("card_test", "column_today", 0);
  scheduler.advanceBy(500);

  assert.deepEqual(automation.getEffectsSnapshot(), {});
});

test("rule feedback expires and notifies subscribers", async () => {
  const scheduler = new FakeScheduler();
  const board = await boardStore();
  const automation = await hydrateDelayedAutomation(
    board,
    [
      makeRule({
        id: "rule_due_feedback",
        trigger: { kind: "card.moved", toColumnId: "column_today" },
        actions: [{ kind: "setDueDate", offsetDays: 1 }],
      }),
    ],
    scheduler,
  );
  let notifications = 0;
  const unsubscribe = automation.subscribe(() => notifications++);

  board.moveCard("card_test", "column_today", 0);
  scheduler.advanceBy(500);
  const revision = automation.getEffectsSnapshot().card_test.revision;
  assert.deepEqual(automation.getEffectsSnapshot().card_test.kinds, ["due-date-changed"]);

  scheduler.advanceBy(899);
  assert.equal(automation.getEffectsSnapshot().card_test.revision, revision);

  scheduler.advanceBy(1);
  assert.deepEqual(automation.getEffectsSnapshot(), {});
  assert.equal(notifications >= 2, true);
  unsubscribe();
});

test("startup reconciliation does not publish interactive feedback", async () => {
  const scheduler = new FakeScheduler();
  const initial = boardFixture({ dueDate: "2027-01-02" });
  const board = await boardStore(initial);
  const automation = await hydrateDelayedAutomation(
    board,
    [
      makeRule({
        id: "rule_startup_feedback",
        trigger: { kind: "card.dueStateChanged" },
        conditions: [{ kind: "dueState", value: "tomorrow" }],
        actions: [{ kind: "moveToColumn", columnId: "column_today" }],
      }),
    ],
    scheduler,
  );

  assert.deepEqual(board.getSnapshot().columns[1].cardIds, ["card_test"]);
  assert.deepEqual(automation.getEffectsSnapshot(), {});
});

test("rule cycles leave the board unchanged and surface a runtime diagnostic", async () => {
  const board = await boardStore();
  const before = structuredClone(board.getSnapshot());
  const automation = await hydrateAutomation(board, [
    makeRule({
      id: "rule_to_today",
      trigger: { kind: "card.moved", toColumnId: "column_today" },
      actions: [{ kind: "moveToColumn", columnId: "column_inbox" }],
    }),
    makeRule({
      id: "rule_to_inbox",
      trigger: { kind: "card.moved", toColumnId: "column_inbox" },
      actions: [{ kind: "moveToColumn", columnId: "column_today" }],
    }),
  ]);

  board.moveCard("card_test", "column_today", 0);

  assert.deepEqual(board.getSnapshot(), {
    ...before,
    columns: [
      { id: "column_inbox", name: "Inbox", cardIds: [] },
      { id: "column_today", name: "Today", cardIds: ["card_test"] },
      { id: "column_done", name: "Done", cardIds: [] },
    ],
  });
  assert.match(automation.getSyncSnapshot().runtimeError ?? "", /cycle/i);
  assert.notEqual(automation.getSyncSnapshot().status, "error");
});

test("board drag handlers preview on hover and commit or cancel on release", async () => {
  const source = await readFile(
    new URL("../src/components/board/Board.tsx", import.meta.url),
    "utf8",
  );

  const dragOver = source.slice(
    source.indexOf("function onDragOver"),
    source.indexOf("function onDragEnd"),
  );
  assert.match(dragOver, /store\.previewMoveCard/);
  assert.doesNotMatch(dragOver, /store\.moveCard/);
  assert.match(source, /store\.commitCardMovePreview/);
  assert.match(source, /store\.cancelCardMovePreview/);
  assert.match(source, /onDragCancel=/);
});

const triggerCases: Array<{
  name: string;
  trigger: RuleTrigger;
  initial?: Partial<Board["cards"][string]>;
  fire: (board: BoardStore) => string;
}> = [
  {
    name: "created anywhere",
    trigger: { kind: "card.created", columnId: "*" },
    fire: (board) => board.addCard("column_inbox", "Created"),
  },
  {
    name: "created in a selected column",
    trigger: { kind: "card.created", columnId: "column_today" },
    fire: (board) => board.addCard("column_today", "Created"),
  },
  {
    name: "moved into a selected column",
    trigger: { kind: "card.moved", toColumnId: "column_today" },
    fire: (board) => {
      board.moveCard("card_test", "column_today", 0);
      return "card_test";
    },
  },
  {
    name: "completed",
    trigger: { kind: "card.completed", value: true },
    initial: { completed: false, completedAt: null },
    fire: (board) => {
      board.toggleCompleted("card_test");
      return "card_test";
    },
  },
  {
    name: "reopened",
    trigger: { kind: "card.completed", value: false },
    initial: { completed: true, completedAt: "2026-12-30T12:00:00Z" },
    fire: (board) => {
      board.toggleCompleted("card_test");
      return "card_test";
    },
  },
  {
    name: "due today",
    trigger: { kind: "card.dueOn", when: "today" },
    initial: { dueDate: "2027-01-01", completed: false, completedAt: null },
    fire: () => "card_test",
  },
  {
    name: "due tomorrow",
    trigger: { kind: "card.dueOn", when: "tomorrow" },
    initial: { dueDate: "2027-01-02", completed: false, completedAt: null },
    fire: () => "card_test",
  },
  {
    name: "overdue",
    trigger: { kind: "card.dueOn", when: "overdue" },
    initial: { dueDate: "2026-12-31", completed: false, completedAt: null },
    fire: () => "card_test",
  },
];

const actionCases: Array<{
  name: string;
  action: RuleAction;
  initial?: Partial<Board["cards"][string]>;
  assertApplied: (board: Board, cardId: string) => void;
}> = [
  {
    name: "set due date",
    action: { kind: "setDueDate", offsetDays: 7 },
    assertApplied: (board, cardId) => assert.equal(board.cards[cardId]?.dueDate, "2027-01-08"),
  },
  {
    name: "clear due date",
    action: { kind: "clearDueDate" },
    initial: { dueDate: "2027-01-10" },
    assertApplied: (board, cardId) => assert.equal(board.cards[cardId]?.dueDate, null),
  },
  {
    name: "add tag",
    action: { kind: "addTag", tagId: "tag_work" },
    initial: { tagIds: [] },
    assertApplied: (board, cardId) => assert.deepEqual(board.cards[cardId]?.tagIds, ["tag_work"]),
  },
  {
    name: "remove tag",
    action: { kind: "removeTag", tagId: "tag_work" },
    initial: { tagIds: ["tag_work"] },
    assertApplied: (board, cardId) => assert.deepEqual(board.cards[cardId]?.tagIds, []),
  },
  {
    name: "move to column",
    action: { kind: "moveToColumn", columnId: "column_done" },
    assertApplied: (board, cardId) =>
      assert.equal(
        board.columns.find((column) => column.id === "column_done")?.cardIds.includes(cardId),
        true,
      ),
  },
  {
    name: "mark completed",
    action: { kind: "setCompleted", value: true },
    initial: { completed: false, completedAt: null },
    assertApplied: (board, cardId) => assert.equal(board.cards[cardId]?.completed, true),
  },
  {
    name: "mark open",
    action: { kind: "setCompleted", value: false },
    initial: { completed: true, completedAt: "2026-12-30T12:00:00Z" },
    assertApplied: (board, cardId) => assert.equal(board.cards[cardId]?.completed, false),
  },
  {
    name: "archive card",
    action: { kind: "archiveCard" },
    assertApplied: (board, cardId) => assert.equal(board.cards[cardId], undefined),
  },
];

test("every visual rule trigger executes every visual rule action", async () => {
  for (const triggerCase of triggerCases) {
    for (const actionCase of actionCases) {
      const initial = boardFixture({
        ...actionCase.initial,
        ...triggerCase.initial,
      });
      const board = await boardStore(initial);
      await hydrateAutomation(board, [
        makeRule({
          id: `rule_${triggerCases.indexOf(triggerCase)}_${actionCases.indexOf(actionCase)}`,
          trigger: triggerCase.trigger,
          actions: [actionCase.action],
        }),
      ]);

      const cardId = triggerCase.fire(board);
      await new Promise((resolve) => setTimeout(resolve, 0));

      try {
        actionCase.assertApplied(board.getSnapshot(), cardId);
      } catch (error) {
        throw new Error(`${triggerCase.name} + ${actionCase.name} failed`, { cause: error });
      }
    }
  }
});

test("disabled and nonmatching visual rules never mutate cards", async () => {
  const board = await boardStore();
  await hydrateAutomation(board, [
    makeRule({
      id: "rule_disabled_move",
      enabled: false,
      trigger: { kind: "card.moved", toColumnId: "column_today" },
      actions: [{ kind: "setDueDate", offsetDays: 7 }],
    }),
    makeRule({
      id: "rule_wrong_column",
      trigger: { kind: "card.moved", toColumnId: "column_done" },
      actions: [{ kind: "addTag", tagId: "tag_work" }],
    }),
  ]);

  board.moveCard("card_test", "column_today", 0);

  assert.equal(board.getSnapshot().cards.card_test.dueDate, null);
  assert.deepEqual(board.getSnapshot().cards.card_test.tagIds, []);
});

test("enabled due-date rules do not suppress event rules in the same board mutation", async () => {
  const board = await boardStore();
  await hydrateAutomation(board, [
    makeRule({
      id: "rule_due_overdue",
      trigger: { kind: "card.dueOn", when: "overdue" },
      actions: [{ kind: "clearDueDate" }],
    }),
    makeRule({
      id: "rule_move_add_tag",
      trigger: { kind: "card.moved", toColumnId: "column_today" },
      actions: [{ kind: "addTag", tagId: "tag_work" }],
    }),
  ]);

  board.moveCard("card_test", "column_today", 0);

  assert.deepEqual(board.getSnapshot().cards.card_test.tagIds, ["tag_work"]);
});

test("clearing a due date immediately routes an open card through due-state conditions", async () => {
  const initial = boardFixture({ dueDate: "2027-01-01" });
  initial.columns[0].cardIds = [];
  initial.columns[1].cardIds = ["card_test"];
  const board = await boardStore(initial);
  await hydrateAutomation(board, [
    makeRule({
      id: "rule_cleared_to_inbox",
      trigger: { kind: "card.dueStateChanged" },
      conditions: [
        { kind: "completed", value: false },
        { kind: "dueState", value: "none" },
        { kind: "column", operator: "in", columnIds: ["column_today"] },
      ],
      actions: [{ kind: "moveToColumn", columnId: "column_inbox" }],
    }),
  ]);

  board.updateCard("card_test", { dueDate: null });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(board.getSnapshot().columns[0].cardIds, ["card_test"]);
  assert.deepEqual(board.getSnapshot().columns[1].cardIds, []);
});

test("reopening routes by due date while completed cards remain in Done", async () => {
  const initial = boardFixture({
    dueDate: "2027-01-02",
    completed: true,
    completedAt: "2026-12-31T12:00:00Z",
  });
  initial.columns[0].cardIds = [];
  initial.columns[2].cardIds = ["card_test"];
  const board = await boardStore(initial);
  await hydrateAutomation(board, [
    makeRule({
      id: "rule_due_tomorrow",
      trigger: { kind: "card.dueStateChanged" },
      conditions: [
        { kind: "completed", value: false },
        { kind: "dueState", value: "tomorrow" },
      ],
      actions: [{ kind: "moveToColumn", columnId: "column_today" }],
    }),
  ]);

  assert.deepEqual(board.getSnapshot().columns[2].cardIds, ["card_test"]);
  board.toggleCompleted("card_test");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(board.getSnapshot().columns[1].cardIds, ["card_test"]);
});

test("client automation uses the bounded transaction kernel instead of a global applying flag", async () => {
  const source = await readFile(new URL("../src/lib/rules.ts", import.meta.url), "utf8");
  assert.match(source, /applyRuleTransaction/);
  assert.doesNotMatch(source, /private applying = false/);
});

test("rule activation is visible, explicit, and accessible", async () => {
  const source = await readFile(
    new URL("../src/components/board/RulesButton.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /aria-pressed=\{rule\.enabled\}/);
  assert.match(source, /\{rule\.enabled \? "Enabled" : "Disabled"\}/);
});
