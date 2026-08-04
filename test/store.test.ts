import assert from "node:assert/strict";
import test from "node:test";

import { BoardStore, type BoardPersistence } from "../src/lib/store.ts";
import type { Board } from "../src/lib/types.ts";

const initialBoard: Board = {
  columns: [
    { id: "column_one", name: "One", cardIds: ["card_test"] },
    { id: "column_two", name: "Two", cardIds: [] },
  ],
  cards: {
    card_test: {
      id: "card_test",
      title: "Persist me",
      description: "",
      dueDate: null,
      checklist: [],
      comments: [],
      tagIds: [],
      completed: false,
      completedAt: null,
      createdAt: "2026-07-21T08:00:00Z",
      updatedAt: "2026-07-21T08:00:00Z",
    },
  },
  tags: [],
};

test("failed persistence rolls back optimistic moves and blocks further edits", async () => {
  const persistence: BoardPersistence = {
    read: async () => ({ path: "/workspace", board: structuredClone(initialBoard) }),
    save: async () => {
      throw new Error("server unavailable");
    },
  };
  const store = new BoardStore(persistence, 0);
  await store.reloadFromDisk();

  store.moveCard("card_test", "column_two", 0);
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(store.getSyncSnapshot().status, "error");
  assert.match(store.getSyncSnapshot().error ?? "", /server unavailable/);
  assert.deepEqual(store.getSnapshot().columns, initialBoard.columns);

  store.moveCard("card_test", "column_two", 0);
  assert.deepEqual(store.getSnapshot().columns, initialBoard.columns);
});

test("rollback uses the most recently confirmed filesystem state", async () => {
  let saves = 0;
  const persistence: BoardPersistence = {
    read: async () => ({ path: "/workspace", board: structuredClone(initialBoard) }),
    save: async () => {
      saves++;
      if (saves === 2) throw new Error("server stopped");
      return { path: "/workspace" };
    },
  };
  const store = new BoardStore(persistence, 0);
  await store.reloadFromDisk();

  store.moveCard("card_test", "column_two", 0);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const confirmed = structuredClone(store.getSnapshot().columns);
  assert.equal(store.getSyncSnapshot().status, "saved");

  store.moveCard("card_test", "column_one", 0);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(store.getSyncSnapshot().status, "error");
  assert.deepEqual(store.getSnapshot().columns, confirmed);
});

test("explicit flush persists edits before the debounce window expires", async () => {
  const savedBoards: Board[] = [];
  const persistence: BoardPersistence = {
    read: async () => ({ path: "/workspace", board: structuredClone(initialBoard) }),
    save: async (board) => {
      savedBoards.push(structuredClone(board));
      return { path: "/workspace" };
    },
  };
  const store = new BoardStore(persistence, 10_000);
  await store.reloadFromDisk();

  store.updateCard("card_test", {
    title: "Saved before close",
    description: "No debounce data loss",
  });
  await store.flushPendingSave();

  assert.equal(savedBoards.length, 1);
  assert.equal(savedBoards[0].cards.card_test.title, "Saved before close");
  assert.equal(savedBoards[0].cards.card_test.description, "No debounce data loss");
  assert.equal(store.getSyncSnapshot().status, "saved");
});

test("editing a comment persists only the matching comment body", async () => {
  const initial = structuredClone(initialBoard);
  initial.cards.card_test.comments = [
    {
      id: "comment_first",
      body: "First comment",
      createdAt: "2026-07-21T08:05:00Z",
    },
    {
      id: "comment_second",
      body: "Second comment",
      createdAt: "2026-07-21T08:10:00Z",
    },
  ];
  const savedBoards: Board[] = [];
  const store = new BoardStore(
    {
      read: async () => ({ path: "/workspace", board: structuredClone(initial) }),
      save: async (board) => {
        savedBoards.push(structuredClone(board));
        return { path: "/workspace" };
      },
    },
    10_000,
  );
  await store.reloadFromDisk();

  store.updateComment("card_test", "comment_first", "See [the guide](https://example.com). ");
  await store.flushPendingSave();

  assert.equal(savedBoards.length, 1);
  assert.deepEqual(savedBoards[0].cards.card_test.comments, [
    {
      id: "comment_first",
      body: "See [the guide](https://example.com). ",
      createdAt: "2026-07-21T08:05:00Z",
    },
    {
      id: "comment_second",
      body: "Second comment",
      createdAt: "2026-07-21T08:10:00Z",
    },
  ]);
});

test("drag previews update the visible board without saving or dispatching move events", async () => {
  const savedBoards: Board[] = [];
  const events: string[] = [];
  const persistence: BoardPersistence = {
    read: async () => ({ path: "/workspace", board: structuredClone(initialBoard) }),
    save: async (board) => {
      savedBoards.push(structuredClone(board));
      return { path: "/workspace" };
    },
  };
  const store = new BoardStore(persistence, 0);
  await store.reloadFromDisk();
  store.onEvent((event) => events.push(event.kind));

  store.previewMoveCard("card_test", "column_two", 0);
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.deepEqual(store.getSnapshot().columns[0].cardIds, []);
  assert.deepEqual(store.getSnapshot().columns[1].cardIds, ["card_test"]);
  assert.equal(store.isPreviewingMove(), true);
  assert.equal(store.getSyncSnapshot().status, "saved");
  assert.equal(savedBoards.length, 0);
  assert.deepEqual(events, []);
});

test("cancelling a drag restores the authoritative board without saving or events", async () => {
  let saves = 0;
  const store = new BoardStore(
    {
      read: async () => ({ path: "/workspace", board: structuredClone(initialBoard) }),
      save: async () => {
        saves++;
        return { path: "/workspace" };
      },
    },
    0,
  );
  const events: string[] = [];
  await store.reloadFromDisk();
  store.onEvent((event) => events.push(event.kind));

  store.previewMoveCard("card_test", "column_two", 0);
  store.cancelCardMovePreview();
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.deepEqual(store.getSnapshot().columns, initialBoard.columns);
  assert.equal(store.isPreviewingMove(), false);
  assert.equal(saves, 0);
  assert.deepEqual(events, []);
});

test("committing a drag persists once and dispatches one move event from its origin", async () => {
  const savedBoards: Board[] = [];
  const events: unknown[] = [];
  const store = new BoardStore(
    {
      read: async () => ({ path: "/workspace", board: structuredClone(initialBoard) }),
      save: async (board) => {
        savedBoards.push(structuredClone(board));
        return { path: "/workspace" };
      },
    },
    10_000,
  );
  await store.reloadFromDisk();
  store.onEvent((event) => events.push(event));

  store.previewMoveCard("card_test", "column_two", 0);
  store.commitCardMovePreview("card_test", "column_one");
  await store.flushPendingSave();

  assert.equal(savedBoards.length, 1);
  assert.deepEqual(savedBoards[0].columns[1].cardIds, ["card_test"]);
  assert.deepEqual(events, [
    {
      kind: "card.moved",
      cardId: "card_test",
      fromColumnId: "column_one",
      toColumnId: "column_two",
    },
  ]);
});

test("drag commit applies its final order before dispatching the move event", async () => {
  const initial = structuredClone(initialBoard);
  initial.cards.card_other = {
    ...structuredClone(initial.cards.card_test),
    id: "card_other",
    title: "Other card",
  };
  initial.columns[1].cardIds = ["card_other"];

  const observedOrders: string[][] = [];
  const savedBoards: Board[] = [];
  const store = new BoardStore(
    {
      read: async () => ({ path: "/workspace", board: structuredClone(initial) }),
      save: async (board) => {
        savedBoards.push(structuredClone(board));
        return { path: "/workspace" };
      },
    },
    10_000,
  );
  await store.reloadFromDisk();
  store.onEvent(() => {
    observedOrders.push([
      ...(store.getSnapshot().columns.find((column) => column.id === "column_two")?.cardIds ?? []),
    ]);
  });

  store.previewMoveCard("card_test", "column_two", 0);
  store.commitCardMovePreview("card_test", "column_one", {
    columnId: "column_two",
    cardIds: ["card_other", "card_test"],
  });
  await store.flushPendingSave();

  assert.deepEqual(observedOrders, [["card_other", "card_test"]]);
  assert.deepEqual(savedBoards[0].columns[1].cardIds, ["card_other", "card_test"]);
});

test("same-column drag commit can apply a final order without a move preview", async () => {
  const initial = structuredClone(initialBoard);
  initial.cards.card_other = {
    ...structuredClone(initial.cards.card_test),
    id: "card_other",
    title: "Other card",
  };
  initial.columns[0].cardIds = ["card_test", "card_other"];

  const savedBoards: Board[] = [];
  const store = new BoardStore(
    {
      read: async () => ({ path: "/workspace", board: structuredClone(initial) }),
      save: async (board) => {
        savedBoards.push(structuredClone(board));
        return { path: "/workspace" };
      },
    },
    10_000,
  );
  await store.reloadFromDisk();

  store.commitCardMovePreview("card_test", "column_one", {
    columnId: "column_one",
    cardIds: ["card_other", "card_test"],
  });
  await store.flushPendingSave();

  assert.deepEqual(store.getSnapshot().columns[0].cardIds, ["card_other", "card_test"]);
  assert.deepEqual(savedBoards[0].columns[0].cardIds, ["card_other", "card_test"]);
});

test("stale column ordering cannot reinsert a card that rules already moved", async () => {
  const store = new BoardStore(
    {
      read: async () => ({ path: "/workspace", board: structuredClone(initialBoard) }),
      save: async () => ({ path: "/workspace" }),
    },
    10_000,
  );
  await store.reloadFromDisk();

  store.moveCard("card_test", "column_two", 0);
  store.reorderCardsInColumn("column_one", ["card_test"]);

  const occurrences = store
    .getSnapshot()
    .columns.reduce(
      (count, column) => count + column.cardIds.filter((cardId) => cardId === "card_test").length,
      0,
    );
  assert.equal(occurrences, 1);
  assert.deepEqual(store.getSnapshot().columns[0].cardIds, []);
  assert.deepEqual(store.getSnapshot().columns[1].cardIds, ["card_test"]);
});

test("a persistence failure during a drag clears the preview and restores confirmed state", async () => {
  const store = new BoardStore(
    {
      read: async () => ({ path: "/workspace", board: structuredClone(initialBoard) }),
      save: async () => {
        throw new Error("workspace disconnected");
      },
    },
    10_000,
  );
  await store.reloadFromDisk();

  store.updateCard("card_test", { title: "Pending edit" });
  store.previewMoveCard("card_test", "column_two", 0);
  await store.flushPendingSave();

  assert.equal(store.getSyncSnapshot().status, "error");
  assert.equal(store.isPreviewingMove(), false);
  assert.deepEqual(store.getSnapshot().columns, initialBoard.columns);
  assert.equal(store.getSnapshot().cards.card_test.title, "Persist me");

  store.commitCardMovePreview("card_test", "column_one");
  assert.deepEqual(store.getSnapshot().columns, initialBoard.columns);
});
