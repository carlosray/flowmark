import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("board footer shows only the absolute workspace path as plain text", async () => {
  const boardSource = await readFile(
    new URL("../src/components/board/Board.tsx", import.meta.url),
    "utf8",
  );

  assert.match(boardSource, /<code[^>]*title=\{sync\.filePath \?\? "…"\}[^>]*>/);
  assert.match(boardSource, /\{sync\.filePath \?\? "…"\}\s*<\/code>/);
  assert.doesNotMatch(boardSource, /StorageInfo/);
  assert.doesNotMatch(boardSource, /Local-first|Markdown files as source of truth/);
});
