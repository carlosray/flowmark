import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";

import { initializeWorkspace } from "../src/lib/workspace/initializer.ts";
import { readWorkspaceBoard, writeWorkspaceBoard } from "../src/lib/workspace/board-repository.ts";

const now = "2026-08-26T09:00:00Z";

async function makeWorkspaceWithOriginCard() {
  const root = await mkdtemp(join(tmpdir(), "flowmark-card-origin-"));
  await initializeWorkspace(root);
  await writeFile(
    join(root, "cards/card_piano.md"),
    `---
schema_version: 1
id: card_piano
title: Piano
column_id: column_inbox
previous_column_id: null
position: 1024
completed: false
completed_at: null
due_at: null
tag_ids: []
checklist_ids: []
comment_ids: []
origin:
  rule_id: rule_piano
  template_id: template_piano
  occurrence: 2026-08-22T08:00:00Z
created_at: ${now}
updated_at: ${now}
archived_at: null
---

Practice notes.
`,
  );
  return root;
}

async function readFrontmatter(root: string, file: string) {
  const source = await readFile(join(root, file), "utf8");
  const match = /^---\n([\s\S]*?)\n---/.exec(source);
  assert.ok(match, `no frontmatter in ${file}`);
  return parse(match[1]);
}

test("board writes preserve the origin marker on an edited card", async () => {
  const root = await makeWorkspaceWithOriginCard();
  const board = await readWorkspaceBoard(root);
  board.cards.card_piano.title = "Piano, renamed";
  await writeWorkspaceBoard(root, board);

  const written = await readFrontmatter(root, "cards/card_piano.md");
  assert.equal(written.title, "Piano, renamed");
  assert.deepEqual(written.origin, {
    rule_id: "rule_piano",
    template_id: "template_piano",
    occurrence: "2026-08-22T08:00:00Z",
  });
  await rm(root, { recursive: true, force: true });
});

test("archiving a card carries its origin marker into the archive", async () => {
  const root = await makeWorkspaceWithOriginCard();
  const board = await readWorkspaceBoard(root);
  delete board.cards.card_piano;
  board.columns[0].cardIds = board.columns[0].cardIds.filter((id) => id !== "card_piano");
  await writeWorkspaceBoard(root, board);

  const archived = await readFrontmatter(root, "archive/cards/card_piano.md");
  assert.equal(archived.origin.rule_id, "rule_piano");
  assert.equal(archived.origin.occurrence, "2026-08-22T08:00:00Z");
  await rm(root, { recursive: true, force: true });
});

test("a card without an origin marker does not gain one", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-card-origin-"));
  await initializeWorkspace(root);
  await writeFile(
    join(root, "cards/card_plain.md"),
    `---
schema_version: 1
id: card_plain
title: Plain
column_id: column_inbox
previous_column_id: null
position: 1024
completed: false
completed_at: null
due_at: null
tag_ids: []
checklist_ids: []
comment_ids: []
created_at: ${now}
updated_at: ${now}
archived_at: null
---

Body.
`,
  );
  const board = await readWorkspaceBoard(root);
  board.cards.card_plain.title = "Plain, renamed";
  await writeWorkspaceBoard(root, board);

  const written = await readFrontmatter(root, "cards/card_plain.md");
  assert.equal("origin" in written, false);
  await rm(root, { recursive: true, force: true });
});
