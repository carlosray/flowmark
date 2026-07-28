import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ChecklistExpansionStore } from "../src/lib/checklist-expansion.ts";

test("hydrates and remembers expansion independently for each card", async () => {
  const writes: string[][] = [];
  const store = new ChecklistExpansionStore(async (cardIds) => {
    writes.push([...cardIds]);
  });

  store.hydrate(["card_alpha"]);
  assert.equal(store.isExpanded("card_alpha"), true);
  assert.equal(store.isExpanded("card_beta"), false);

  store.toggle("card_beta");
  await store.flushPendingSave();
  assert.equal(store.isExpanded("card_alpha"), true);
  assert.equal(store.isExpanded("card_beta"), true);
  assert.deepEqual(writes, [["card_alpha", "card_beta"]]);

  store.toggle("card_alpha");
  await store.flushPendingSave();
  assert.equal(store.isExpanded("card_alpha"), false);
  assert.equal(store.isExpanded("card_beta"), true);
  assert.deepEqual(writes.at(-1), ["card_beta"]);
});

test("a disposable preference write failure does not undo the visible choice", async () => {
  const store = new ChecklistExpansionStore(async () => {
    throw new Error("runtime state unavailable");
  });
  store.hydrate([]);

  store.toggle("card_alpha");
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(store.isExpanded("card_alpha"), true);
});

test("a later preference save still runs after an earlier save fails", async () => {
  const writes: string[][] = [];
  let attempts = 0;
  const store = new ChecklistExpansionStore(async (cardIds) => {
    attempts += 1;
    if (attempts === 1) throw new Error("runtime state temporarily unavailable");
    writes.push([...cardIds]);
  });
  store.hydrate([]);

  store.toggle("card_alpha");
  store.toggle("card_beta");
  await store.flushPendingSave();

  assert.equal(attempts, 2);
  assert.deepEqual(writes, [["card_alpha", "card_beta"]]);
});

test("card items use the shared per-card store and the route supplies initial state", async () => {
  const cardItem = await readFile(
    new URL("../src/components/board/CardItem.tsx", import.meta.url),
    "utf8",
  );
  const board = await readFile(
    new URL("../src/components/board/Board.tsx", import.meta.url),
    "utf8",
  );
  const route = await readFile(new URL("../src/routes/index.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(cardItem, /useState\(false\)/);
  assert.match(cardItem, /useChecklistExpanded\(card\.id\)/);
  assert.match(cardItem, /checklistExpansionStore\.toggle\(card\.id\)/);
  assert.match(cardItem, /aria-expanded=\{checklistOpen\}/);
  assert.match(board, /useRef\(initialExpandedChecklistCardIds\)/);
  assert.match(
    board,
    /checklistExpansionStore\.hydrate\(initialExpandedChecklistCardIdsRef\.current\)/,
  );
  assert.match(route, /getExpandedChecklistCardIds/);
  assert.match(route, /initialExpandedChecklistCardIds/);
});
