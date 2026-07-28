import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { matchesTagFilter } from "../src/lib/board-filters.ts";
import { reloadWithMinimumFeedback } from "../src/lib/reload-feedback.ts";

test("tag filtering uses AND semantics and is neutral when no tags are selected", () => {
  assert.equal(matchesTagFilter(["tag_work"], []), true);
  assert.equal(matchesTagFilter(["tag_work"], ["tag_work"]), true);
  assert.equal(matchesTagFilter(["tag_work"], ["tag_home"]), false);
  assert.equal(matchesTagFilter(["tag_work"], ["tag_work", "tag_home"]), false);
  assert.equal(matchesTagFilter(["tag_work", "tag_home"], ["tag_work", "tag_home"]), true);
});

test("the existing Tags button combines board filtering and tag management", async () => {
  const boardSource = await readFile(
    new URL("../src/components/board/Board.tsx", import.meta.url),
    "utf8",
  );
  const tagSource = await readFile(
    new URL("../src/components/board/TagPicker.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    boardSource,
    /<ManageTagsButton\s+selectedTagIds=\{tagFilter\}\s+onSelectedTagIdsChange=\{setTagFilter\}/,
  );
  assert.match(boardSource, /matchesTagFilter\(c\.tagIds, tagFilter\)/);
  assert.doesNotMatch(boardSource, /function TagFilterPopover/);

  assert.match(tagSource, />Filter board</);
  assert.match(tagSource, />Tag library</);
  assert.match(tagSource, /selectedTagIds\.includes\(t\.id\)/);
  assert.match(tagSource, /Clear filter/);
  assert.match(tagSource, /activeFilterCount/);
});

test("deleting or reloading away a tag removes it from the active filter", async () => {
  const tagSource = await readFile(
    new URL("../src/components/board/TagPicker.tsx", import.meta.url),
    "utf8",
  );

  assert.match(tagSource, /selectedTagIds\.filter\(\(id\) => availableTagIds\.has\(id\)\)/);
  assert.match(tagSource, /onDelete=\{\(\) => removeTag\(t\.id\)\}/);
});

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

test("reload feedback starts reload and minimum delay together and waits for both", async () => {
  const reload = deferred();
  const minimum = deferred();
  let settled = false;

  const running = reloadWithMinimumFeedback(
    () => reload.promise,
    async (milliseconds) => {
      assert.equal(milliseconds, 350);
      await minimum.promise;
    },
  ).then(() => {
    settled = true;
  });

  reload.resolve();
  await Promise.resolve();
  assert.equal(settled, false, "fast reload must keep perceptible feedback");

  minimum.resolve();
  await running;
  assert.equal(settled, true);
});

test("reload feedback does not finish while the real disk reload is still running", async () => {
  const reload = deferred();
  const minimum = deferred();
  let settled = false;

  const running = reloadWithMinimumFeedback(
    () => reload.promise,
    () => minimum.promise,
  ).then(() => {
    settled = true;
  });

  minimum.resolve();
  await Promise.resolve();
  assert.equal(settled, false);

  reload.resolve();
  await running;
  assert.equal(settled, true);
});

test("reload errors still wait for minimum feedback before restoring the button", async () => {
  const minimum = deferred();
  const failure = new Error("disk unavailable");
  let rejected = false;

  const running = reloadWithMinimumFeedback(
    async () => {
      throw failure;
    },
    () => minimum.promise,
  ).catch((error) => {
    assert.equal(error, failure);
    rejected = true;
  });

  await Promise.resolve();
  assert.equal(rejected, false);
  minimum.resolve();
  await running;
  assert.equal(rejected, true);
});

test("reload button exposes busy state, animation, and reduced-motion fallback", async () => {
  const boardSource = await readFile(
    new URL("../src/components/board/Board.tsx", import.meta.url),
    "utf8",
  );
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

  assert.match(boardSource, /function ReloadWorkspaceButton/);
  assert.match(boardSource, /reloadWithMinimumFeedback/);
  assert.match(boardSource, /disabled=\{reloading\}/);
  assert.match(boardSource, /aria-busy=\{reloading\}/);
  assert.match(boardSource, /flowmark-reload-spin/);
  assert.match(styles, /@keyframes flowmark-reload-spin/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
  assert.match(styles, /\.flowmark-reload-spin/);
});
