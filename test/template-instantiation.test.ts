import assert from "node:assert/strict";
import test from "node:test";

import { instantiateTemplate } from "../src/lib/workspace/template-instantiation.ts";
import type { CardTemplate } from "../src/lib/workspace/templates-repository.ts";

const occurrence = new Date("2026-08-26T08:00:00Z");

function piano(overrides: Partial<CardTemplate> = {}): CardTemplate {
  return {
    id: "template_piano",
    name: "Piano practice",
    title: "Piano · {{date:iso}}",
    body: "Practice on {{weekday}}.\n",
    columnId: "column_to_plan",
    tagIds: ["tag_music"],
    due: { mode: "offset", offsetDays: 2 },
    checklist: ["Scales", "Piece for week {{week}}"],
    ...overrides,
  };
}

function instantiate(template: CardTemplate, overrides: Record<string, unknown> = {}) {
  return instantiateTemplate({
    template,
    ruleId: "rule_piano",
    occurrence,
    timeZone: "UTC",
    locale: "en",
    defaultColumnId: "column_inbox",
    ...overrides,
  });
}

test("an offset due date resolves relative to the occurrence", () => {
  assert.equal(instantiate(piano()).dueDate, "2026-08-28");
});

test("a negative offset resolves before the occurrence", () => {
  assert.equal(
    instantiate(piano({ due: { mode: "offset", offsetDays: -3 } })).dueDate,
    "2026-08-23",
  );
});

test("a fixed due date passes through and none yields null", () => {
  assert.equal(
    instantiate(piano({ due: { mode: "fixed", date: "2026-09-01" } })).dueDate,
    "2026-09-01",
  );
  assert.equal(instantiate(piano({ due: { mode: "none" } })).dueDate, null);
});

test("the offset is measured in the rule timezone, not UTC", () => {
  const card = instantiate(piano({ due: { mode: "offset", offsetDays: 0 } }), {
    occurrence: new Date("2026-08-26T23:30:00Z"),
    timeZone: "Europe/Amsterdam",
  });
  assert.equal(card.dueDate, "2026-08-27");
});

test("the title can render the due date the card is about to receive", () => {
  const card = instantiate(piano({ title: "Piano · {{due_date}}" }));
  assert.equal(card.title, "Piano · 2026-08-28");
});

test("title, body, and checklist all render their expressions", () => {
  const card = instantiate(piano());
  assert.equal(card.title, "Piano · 2026-08-26");
  assert.equal(card.body, "Practice on Wednesday.\n");
  assert.deepEqual(card.checklist, ["Scales", "Piece for week 35"]);
});

test("the column override beats the template, which beats the workspace default", () => {
  assert.equal(instantiate(piano()).columnId, "column_to_plan");
  assert.equal(instantiate(piano(), { columnIdOverride: "column_today" }).columnId, "column_today");
  assert.equal(instantiate(piano({ columnId: null })).columnId, "column_inbox");
  assert.equal(
    instantiate(piano({ columnId: null }), { columnIdOverride: "column_today" }).columnId,
    "column_today",
  );
});

test("the card carries an origin marker naming its rule, template, and occurrence", () => {
  assert.deepEqual(instantiate(piano()).origin, {
    rule_id: "rule_piano",
    template_id: "template_piano",
    occurrence: "2026-08-26T08:00:00.000Z",
  });
});

test("tags are copied and the generated ID is a valid card ID", () => {
  const card = instantiate(piano());
  assert.deepEqual(card.tagIds, ["tag_music"]);
  assert.match(card.cardId, /^card_[a-z0-9]+(?:_[a-z0-9]+)*$/);
});

test("two instantiations of the same template get different card IDs", () => {
  assert.notEqual(instantiate(piano()).cardId, instantiate(piano()).cardId);
});

test("the locale shapes worded formats", () => {
  const card = instantiate(piano({ title: "Пианино · {{date:long}}" }), { locale: "ru" });
  assert.equal(card.title, "Пианино · 26 августа");
});
