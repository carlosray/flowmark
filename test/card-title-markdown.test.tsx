import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("board cards and drag previews render titles with inline Markdown", async () => {
  const cardSource = await readFile(
    new URL("../src/components/board/CardItem.tsx", import.meta.url),
    "utf8",
  );
  const boardSource = await readFile(
    new URL("../src/components/board/Board.tsx", import.meta.url),
    "utf8",
  );

  assert.match(cardSource, /import \{ MarkdownInline \} from "\.\/MarkdownContent"/);
  assert.match(cardSource, /<MarkdownInline>\{card\.title\}<\/MarkdownInline>/);
  assert.match(boardSource, /import \{ MarkdownInline \} from "\.\/MarkdownContent"/);
  assert.match(boardSource, /<MarkdownInline>\{activeCard\.title\}<\/MarkdownInline>/);
});

test("rendered card titles contain long Markdown links inside the card boundary", async () => {
  const cardSource = await readFile(
    new URL("../src/components/board/CardItem.tsx", import.meta.url),
    "utf8",
  );

  assert.match(cardSource, /min-w-0/);
  assert.match(cardSource, /break-words/);
  assert.match(cardSource, /overflow-wrap-anywhere/);
});
