import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  readExpandedChecklistCardIds,
  writeExpandedChecklistCardIds,
} from "../src/lib/workspace/runtime-preferences.ts";

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), "flowmark-runtime-preferences-"));
  await mkdir(join(root, ".flowmark"), { recursive: true });
  return root;
}

test("missing and malformed runtime preferences fall back to no expanded checklists", async () => {
  const root = await makeRoot();
  try {
    assert.deepEqual(await readExpandedChecklistCardIds(root), []);

    await writeFile(join(root, ".flowmark", "runtime.yaml"), "ui: [not: valid");
    assert.deepEqual(await readExpandedChecklistCardIds(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writes normalized per-card expansion state atomically", async () => {
  const root = await makeRoot();
  try {
    await writeExpandedChecklistCardIds(root, [
      "card_second",
      "not-a-card",
      "card_first",
      "card_second",
    ]);

    assert.deepEqual(await readExpandedChecklistCardIds(root), ["card_first", "card_second"]);
    assert.deepEqual(
      (await readdir(join(root, ".flowmark"))).filter((name) => name.endsWith(".tmp")),
      [],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preserves unrelated runtime preferences and comments", async () => {
  const root = await makeRoot();
  try {
    const path = join(root, ".flowmark", "runtime.yaml");
    await writeFile(
      path,
      "# disposable local state\nscheduler:\n  cursor: 42\nui:\n  density: compact\n",
    );

    await writeExpandedChecklistCardIds(root, ["card_alpha"]);

    const updated = await readFile(path, "utf8");
    assert.match(updated, /^# disposable local state/m);
    assert.match(updated, /scheduler:\n {2}cursor: 42/);
    assert.match(updated, /density: compact/);
    assert.match(updated, /expanded_checklist_card_ids:\n {4}- card_alpha/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("replaces a scalar runtime document with valid disposable preferences", async () => {
  const root = await makeRoot();
  try {
    await writeFile(join(root, ".flowmark", "runtime.yaml"), "hello\n");

    await writeExpandedChecklistCardIds(root, ["card_alpha"]);

    assert.deepEqual(await readExpandedChecklistCardIds(root), ["card_alpha"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("replaces a sequence runtime document with valid disposable preferences", async () => {
  const root = await makeRoot();
  try {
    await writeFile(join(root, ".flowmark", "runtime.yaml"), "- old\n- state\n");

    await writeExpandedChecklistCardIds(root, ["card_alpha"]);

    assert.deepEqual(await readExpandedChecklistCardIds(root), ["card_alpha"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
