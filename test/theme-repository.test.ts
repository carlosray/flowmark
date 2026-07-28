import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ThemeId } from "../src/lib/themes.ts";
import { initializeWorkspace } from "../src/lib/workspace/initializer.ts";
import { readWorkspaceTheme, writeWorkspaceTheme } from "../src/lib/workspace/theme-repository.ts";

async function makeWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "flowmark-theme-"));
  const result = await initializeWorkspace(root);
  assert.deepEqual(result.validation.errors, []);
  return root;
}

test("reads the configured theme and defaults old workspaces to Flow Neutral", async () => {
  const root = await makeWorkspace();
  try {
    assert.equal(await readWorkspaceTheme(root), "flow-neutral");
    const path = join(root, "flowmark.yaml");
    await writeFile(path, (await readFile(path, "utf8")).replace("  theme: flow-neutral\n", ""));
    assert.equal(await readWorkspaceTheme(root), "flow-neutral");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writes only ui.theme while preserving comments and unrelated fields", async () => {
  const root = await makeWorkspace();
  try {
    const path = join(root, "flowmark.yaml");
    const source = (await readFile(path, "utf8")).replace(
      "schema_version: 1",
      "# workspace identity must stay here\nschema_version: 1",
    );
    await writeFile(path, source);

    await writeWorkspaceTheme(root, "nord");

    const updated = await readFile(path, "utf8");
    assert.match(updated, /^# workspace identity must stay here/m);
    assert.match(updated, /theme: nord/);
    assert.match(updated, /initial_column_id: column_inbox/);
    assert.equal(await readWorkspaceTheme(root), "nord");
    assert.deepEqual(
      (await readdir(root)).filter((name) => name.endsWith(".tmp")),
      [],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects invalid theme IDs before changing flowmark.yaml", async () => {
  const root = await makeWorkspace();
  try {
    const path = join(root, "flowmark.yaml");
    const before = await readFile(path, "utf8");
    await assert.rejects(
      () => writeWorkspaceTheme(root, "system" as ThemeId),
      /Invalid theme ID: system/,
    );
    assert.equal(await readFile(path, "utf8"), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses to write when the existing workspace is invalid", async () => {
  const root = await makeWorkspace();
  try {
    const path = join(root, "flowmark.yaml");
    const invalid = (await readFile(path, "utf8")).replace(
      "    - column_inbox",
      "    - column_missing",
    );
    await writeFile(path, invalid);

    await assert.rejects(() => writeWorkspaceTheme(root, "nord"), /E_INVALID_COLUMN_ORDER/);
    assert.equal(await readFile(path, "utf8"), invalid);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
