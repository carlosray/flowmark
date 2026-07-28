import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  atomicCreate,
  atomicWrite,
  FileMutation,
  rollbackAndRethrow,
} from "../src/lib/workspace/file-transaction.ts";

test("atomic source writes replace complete file contents", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-atomic-"));
  const path = join(root, "resource.yaml");
  try {
    await writeFile(path, "before\n");
    await atomicWrite(path, "after\n");
    assert.equal(await readFile(path, "utf8"), "after\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("atomic source creation never overwrites an existing file", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-create-"));
  const path = join(root, "resource.yaml");
  try {
    assert.equal(await atomicCreate(path, "first\n"), true);
    assert.equal(await atomicCreate(path, "second\n"), false);
    assert.equal(await readFile(path, "utf8"), "first\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("file mutations roll back writes, removals, moves, and new files", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-transaction-"));
  const archive = join(root, "archive");
  const written = join(root, "written.yaml");
  const removed = join(root, "removed.yaml");
  const moved = join(root, "moved.md");
  const movedTarget = join(archive, "moved.md");
  const created = join(root, "created.yaml");
  try {
    await mkdir(archive);
    await writeFile(written, "original write\n");
    await writeFile(removed, "original remove\n");
    await writeFile(moved, "original move\n");
    const transaction = new FileMutation();

    await transaction.write(written, "changed\n");
    await transaction.remove(removed);
    await transaction.move(moved, movedTarget);
    await transaction.write(created, "new\n");
    await transaction.rollback();

    assert.equal(await readFile(written, "utf8"), "original write\n");
    assert.equal(await readFile(removed, "utf8"), "original remove\n");
    assert.equal(await readFile(moved, "utf8"), "original move\n");
    await assert.rejects(() => readFile(movedTarget, "utf8"));
    await assert.rejects(() => readFile(created, "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rollback failures preserve both the original and recovery errors", async () => {
  const originalError = new Error("workspace validation failed");
  const rollbackError = new Error("could not restore card");

  await assert.rejects(
    () =>
      rollbackAndRethrow(
        {
          rollback: async () => {
            throw rollbackError;
          },
        },
        originalError,
      ),
    (error) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [originalError, rollbackError]);
      assert.equal(error.cause, originalError);
      assert.match(error.message, /workspace validation failed/i);
      assert.match(error.message, /rollback also failed/i);
      return true;
    },
  );
});
