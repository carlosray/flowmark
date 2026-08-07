import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseCardSearch, resolveRequestedCardId } from "../src/lib/card-deep-link.ts";

test("root search accepts only canonical card IDs", () => {
  assert.deepEqual(parseCardSearch({ card: "card_jnuuoqv59qjk", ignored: "value" }), {
    card: "card_jnuuoqv59qjk",
  });
  assert.deepEqual(parseCardSearch({ card: "CARD_bad" }), {});
  assert.deepEqual(parseCardSearch({ card: ["card_one"] }), {});
});

test("a requested card opens only after hydration confirms it is active", () => {
  const cards = { card_one: { id: "card_one" } };
  assert.equal(resolveRequestedCardId("card_one", cards, "loading"), "card_one");
  assert.equal(resolveRequestedCardId("card_one", cards, "saved"), "card_one");
  assert.equal(resolveRequestedCardId("card_missing", cards, "loading"), "card_missing");
  assert.equal(resolveRequestedCardId("card_missing", cards, "saved"), null);
});

test("the root route and board synchronize card modal state with the URL", async () => {
  const route = await readFile(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
  const board = await readFile(
    new URL("../src/components/board/Board.tsx", import.meta.url),
    "utf8",
  );

  assert.match(route, /validateSearch:\s*parseCardSearch/);
  assert.match(route, /initialOpenCardId=\{card\}/);
  assert.match(route, /onOpenCardIdChange/);
  assert.match(board, /initialOpenCardId/);
  assert.match(board, /onOpenCardIdChange/);
  assert.match(board, /resolveRequestedCardId/);
});
