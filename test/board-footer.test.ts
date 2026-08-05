import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("board footer shows only the absolute workspace path as plain text", async () => {
  const boardSource = await readFile(
    new URL("../src/components/board/Board.tsx", import.meta.url),
    "utf8",
  );
  const footerSource = boardSource.match(/<footer[\s\S]*?<\/footer>/)?.[0];

  assert.ok(footerSource);
  assert.match(footerSource, /<code[^>]*title=\{sync\.filePath \?\? "…"\}[^>]*>/);
  assert.match(footerSource, /\{sync\.filePath \?\? "…"\}\s*<\/code>/);
  assert.doesNotMatch(footerSource, /<button|StorageInfo/);
  assert.doesNotMatch(footerSource, /Local-first|Markdown files as source of truth/);
});
