import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCardMention,
  findCardMentionQuery,
  rankCardMentions,
} from "../src/lib/card-mentions.ts";
import type { Card } from "../src/lib/types.ts";

function makeCard(id: string, title: string, updatedAt: string): Card {
  return {
    id,
    title,
    description: "",
    dueDate: null,
    checklist: [],
    comments: [],
    tagIds: [],
    completed: false,
    completedAt: null,
    createdAt: updatedAt,
    updatedAt,
  };
}

test("typing flowmark: starts a card mention query", () => {
  assert.deepEqual(findCardMentionQuery("See flowmark:", "See flowmark:".length), {
    start: 4,
    query: "",
  });
  assert.deepEqual(findCardMentionQuery("See flowmark:fix", "See flowmark:fix".length), {
    start: 4,
    query: "fix",
  });
});

test("mentions start only after a boundary and never re-trigger on inserted links", () => {
  assert.equal(findCardMentionQuery("xflowmark:fix", "xflowmark:fix".length), null);
  const inserted = "See flowmark://card_alpha1 next";
  assert.equal(findCardMentionQuery(inserted, "See flowmark://card_alpha1".length), null);
  assert.equal(findCardMentionQuery("See flowmark:fix later", "See flowmark:fix l".length), null);
});

test("mention suggestions rank prefix matches above substrings and respect the limit", () => {
  const cards = [
    makeCard("card_a", "Unrelated", "2026-08-03T00:00:00.000Z"),
    makeCard("card_b", "Fix login", "2026-08-02T00:00:00.000Z"),
    makeCard("card_c", "The fix", "2026-08-01T00:00:00.000Z"),
    makeCard("card_findme", "Other", "2026-08-04T00:00:00.000Z"),
  ];
  assert.deepEqual(
    rankCardMentions(cards, "fix").map((card) => card.id),
    ["card_b", "card_c"],
  );
  assert.deepEqual(
    rankCardMentions(cards, "findme").map((card) => card.id),
    ["card_findme"],
  );
  assert.deepEqual(
    rankCardMentions(cards, "").map((card) => card.id),
    ["card_findme", "card_a", "card_b", "card_c"],
  );
});

const many = Array.from({ length: 12 }, (_, i) =>
  makeCard(`card_${i}`, `Card ${i}`, `2026-08-01T00:00:0${i}.000Z`),
);

test("empty queries list the most recently updated cards up to the limit", () => {
  const ranked = rankCardMentions(many, "");
  assert.equal(ranked.length, 8);
  assert.equal(ranked[0].id, "card_9");
});

test("applying a mention replaces the typed token and parks the caret after the URL", () => {
  const text = "See flowmark:fix for details";
  const caret = "See flowmark:fix".length;
  const result = applyCardMention(text, caret, 4, "card_alpha1");

  assert.equal(result.text, "See flowmark://card_alpha1 for details");
  assert.equal(result.caret, "See flowmark://card_alpha1".length);
  assert.equal(result.text.slice(result.caret), " for details");
});
