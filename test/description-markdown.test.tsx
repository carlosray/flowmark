import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { MarkdownContent } from "../src/components/board/MarkdownContent.tsx";

function render(markdown: string) {
  return renderToStaticMarkup(<MarkdownContent>{markdown}</MarkdownContent>);
}

test("renders Markdown links as highlighted safe new-tab links", () => {
  const html = render("Read [the guide](https://example.com/guide).");

  assert.match(html, /href="https:\/\/example\.com\/guide"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /text-primary/);
  assert.match(html, /underline/);
  assert.match(html, />the guide<\/a>/);
});

test("Markdown links isolate pointer and click events from editing and dragging parents", async () => {
  const source = await readFile(
    new URL("../src/components/board/MarkdownContent.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /onPointerDown=\{[^}]*stopPropagation/);
  assert.match(source, /onClick=\{[^}]*stopPropagation/);
});

test("neutralizes unsafe Markdown link protocols", () => {
  const html = render("Do not open [this](javascript:alert('x')) or [that](data:text/html,bad).");

  assert.doesNotMatch(html, /href="(?:javascript|data):/i);
  assert.doesNotMatch(html, /javascript:alert/i);
});

test("linkifies plain web URLs without swallowing terminal punctuation", () => {
  const html = render("Visit https://example.com/docs, then www.example.org/help.");

  assert.match(html, /href="https:\/\/example\.com\/docs"/);
  assert.doesNotMatch(html, /href="https:\/\/example\.com\/docs,"/);
  assert.match(html, /href="http:\/\/www\.example\.org\/help"/);
  assert.match(html, />www\.example\.org\/help<\/a>\./);
});

test("does not linkify URLs inside inline code or code blocks", () => {
  const html = render("`https://inline.example`\n\n```text\nhttps://block.example\n```");

  assert.match(html, /<code>https:\/\/inline\.example<\/code>/);
  assert.match(html, /https:\/\/block\.example/);
  assert.doesNotMatch(html, /href=/);
});

test("renders semantic Markdown structures for themed prose styling", () => {
  const html = render(`# Heading

- First
- Second

> Quoted
`);

  assert.match(html, /<h1>Heading<\/h1>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<blockquote>/);
});
