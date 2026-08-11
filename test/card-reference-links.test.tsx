import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { MarkdownContent, MarkdownInline } from "../src/components/board/MarkdownContent.tsx";
import { CardLinkContext } from "../src/components/board/card-link-context.ts";
import {
  buildFlowmarkCardUrl,
  isCardReferenceUrl,
  resolveCardReferenceTarget,
} from "../src/lib/card-links.ts";
import type { Card } from "../src/lib/types.ts";

function makeCard(id: string, title: string, completed = false): Card {
  return {
    id,
    title,
    description: "",
    dueDate: null,
    checklist: [],
    comments: [],
    tagIds: [],
    completed,
    completedAt: completed ? "2026-08-01T00:00:00.000Z" : null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

const cards: Record<string, Card> = {
  card_alpha1: makeCard("card_alpha1", "Fix flaky tests"),
  card_done22: makeCard("card_done22", "Ship release notes", true),
};

function render(markdown: string, workspacePath = "/Users/test/tasks") {
  return renderToStaticMarkup(
    <CardLinkContext.Provider value={{ cards, workspacePath, openCard: () => undefined }}>
      <MarkdownContent cardLinks>{markdown}</MarkdownContent>
    </CardLinkContext.Provider>,
  );
}

test("same-workspace bare card references render as titled card links", () => {
  const html = render("Blocked by flowmark://card_alpha1 until Monday.");

  assert.match(html, /<button/);
  assert.match(html, /Fix flaky tests/);
  assert.doesNotMatch(html, />flowmark:\/\/card_alpha1</);
  assert.match(html, /cards\/card_alpha1\.md/);
});

test("Markdown links to card references keep their authored label and regular link styling", () => {
  const html = render("See [that flaky thing](flowmark://card_alpha1).");

  assert.doesNotMatch(html, /<button/);
  assert.match(html, /<a href="flowmark:\/\/card_alpha1"/);
  assert.match(html, />that flaky thing<\/a>/);
  assert.match(html, /underline/);
});

test("completed cards strike through authored Markdown link labels", () => {
  const html = render("See [the shipped work](flowmark://card_done22).");

  assert.match(html, />the shipped work<\/a>/);
  assert.match(html, /line-through/);
});

test("trailing punctuation stays outside the card reference link", () => {
  const html = render("Depends on flowmark://card_alpha1.");

  assert.match(html, /<button/);
  assert.match(html, /<\/button>\./);
});

test("completed cards keep their completed styling inside the link", () => {
  const html = render("Done in flowmark://card_done22");

  assert.match(html, /<button/);
  assert.match(html, /line-through/);
});

test("unknown card IDs stay plain text", () => {
  const html = render("Old ref flowmark://card_missing9 stays readable.");

  assert.doesNotMatch(html, /<button/);
  assert.match(html, /flowmark:\/\/card_missing9/);
});

test("cross-workspace card links never render", () => {
  const foreign = buildFlowmarkCardUrl("/other/workspace", "card_alpha1");
  const html = render(`Other board: [note](${foreign})`);

  assert.doesNotMatch(html, /<button/);
  assert.match(html, /note/);
});

test("full open URLs render when the workspace matches", () => {
  const own = buildFlowmarkCardUrl("/Users/test/tasks", "card_alpha1");
  const html = render(`Mirror: ${own}`);

  assert.match(html, /<button/);
  assert.match(html, /Fix flaky tests/);
});

test("without the card links flag, references stay unlinked text", () => {
  const html = renderToStaticMarkup(
    <CardLinkContext.Provider value={{ cards, workspacePath: null, openCard: () => undefined }}>
      <MarkdownContent>Raw flowmark://card_alpha1 mention.</MarkdownContent>
    </CardLinkContext.Provider>,
  );

  assert.doesNotMatch(html, /<button/);
  assert.match(html, /flowmark:\/\/card_alpha1/);
});

test("titles and inline text never resolve card references", () => {
  const html = renderToStaticMarkup(
    <CardLinkContext.Provider value={{ cards, workspacePath: null, openCard: () => undefined }}>
      <MarkdownInline>{"Blocked by flowmark://card_alpha1"}</MarkdownInline>
    </CardLinkContext.Provider>,
  );

  assert.doesNotMatch(html, /<button/);
  assert.match(html, /flowmark:\/\/card_alpha1/);
});

test("without a provider, references degrade to plain text", () => {
  const html = renderToStaticMarkup(
    <MarkdownContent cardLinks>{"Refs flowmark://card_alpha1 here."}</MarkdownContent>,
  );

  assert.doesNotMatch(html, /<button/);
});

test("card reference URL resolution accepts shorthand and same-workspace open URLs only", () => {
  assert.equal(isCardReferenceUrl("flowmark://card_alpha1"), true);
  assert.equal(isCardReferenceUrl("flowmark://open?workspace=%2Fws&card=card_alpha1"), true);
  assert.equal(isCardReferenceUrl("https://example.com"), false);

  assert.equal(resolveCardReferenceTarget("flowmark://card_alpha1", "/any"), "card_alpha1");
  assert.equal(resolveCardReferenceTarget("flowmark://other", "/any"), null);

  const own = buildFlowmarkCardUrl("/Users/test/tasks", "card_alpha1");
  assert.equal(resolveCardReferenceTarget(own, "/Users/test/tasks"), "card_alpha1");
  assert.equal(resolveCardReferenceTarget(own, "/Users/test/tasks/"), "card_alpha1");
  assert.equal(resolveCardReferenceTarget(own, "/other/workspace"), null);
  assert.equal(resolveCardReferenceTarget(own, null), null);
});
