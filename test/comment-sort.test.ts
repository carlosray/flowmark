import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { CommentSortStore, sortComments } from "../src/lib/comment-sort.ts";
import type { Comment } from "../src/lib/types.ts";

const comments: Comment[] = [
  { id: "comment_middle", body: "Middle", createdAt: "2026-09-17T10:00:00.000Z" },
  { id: "comment_new", body: "New", createdAt: "2026-09-17T11:00:00.000Z" },
  { id: "comment_old", body: "Old", createdAt: "2026-09-17T09:00:00.000Z" },
];

test("sorts comments by date in both directions without mutating canonical order", () => {
  assert.deepEqual(
    sortComments(comments, "descending").map((comment) => comment.id),
    ["comment_new", "comment_middle", "comment_old"],
  );
  assert.deepEqual(
    sortComments(comments, "ascending").map((comment) => comment.id),
    ["comment_old", "comment_middle", "comment_new"],
  );
  assert.deepEqual(
    comments.map((comment) => comment.id),
    ["comment_middle", "comment_new", "comment_old"],
  );
});

test("uses immutable IDs to order comments with equal or invalid dates", () => {
  const tied: Comment[] = [
    { id: "comment_z", body: "Z", createdAt: "invalid" },
    { id: "comment_b", body: "B", createdAt: "2026-09-17T10:00:00.000Z" },
    { id: "comment_a", body: "A", createdAt: "2026-09-17T10:00:00.000Z" },
  ];

  assert.deepEqual(
    sortComments(tied, "descending").map((comment) => comment.id),
    ["comment_a", "comment_b", "comment_z"],
  );
  assert.deepEqual(
    sortComments(tied, "ascending").map((comment) => comment.id),
    ["comment_z", "comment_a", "comment_b"],
  );
});

test("shared sort preference defaults to descending and hydrates from the workspace", () => {
  const store = new CommentSortStore(async () => {});

  assert.equal(store.getSnapshot(), "descending");
  store.hydrate("ascending");
  assert.equal(store.getSnapshot(), "ascending");
});

test("changing the shared preference notifies listeners and persists the next order", async () => {
  const saved: string[] = [];
  const store = new CommentSortStore(async (order) => {
    saved.push(order);
  });
  let notifications = 0;
  store.subscribe(() => notifications++);

  await store.setOrder("ascending");

  assert.equal(store.getSnapshot(), "ascending");
  assert.deepEqual(saved, ["ascending"]);
  assert.equal(notifications, 1);
});

test("failed persistence restores the previous shared preference", async () => {
  const store = new CommentSortStore(async () => {
    throw new Error("disk unavailable");
  });

  await assert.rejects(store.setOrder("ascending"), /disk unavailable/);

  assert.equal(store.getSnapshot(), "descending");
});

test("rapid changes persist in interaction order so the last selection wins", async () => {
  const started: string[] = [];
  const persisted: string[] = [];
  let releaseFirst = () => {};
  const firstSave = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const store = new CommentSortStore(async (order) => {
    started.push(order);
    if (order === "ascending") await firstSave;
    persisted.push(order);
  });

  const ascending = store.setOrder("ascending");
  const descending = store.setOrder("descending");
  await Promise.resolve();

  assert.deepEqual(started, ["ascending"]);
  releaseFirst();
  await Promise.all([ascending, descending]);

  assert.deepEqual(persisted, ["ascending", "descending"]);
  assert.equal(store.getSnapshot(), "descending");
});

test("the index loader hydrates the workspace-wide comment preference", async () => {
  const routeSource = await readFile(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
  const boardSource = await readFile(
    new URL("../src/components/board/Board.tsx", import.meta.url),
    "utf8",
  );

  assert.match(routeSource, /getCommentSortOrder/);
  assert.match(routeSource, /commentSortOrder/);
  assert.match(routeSource, /initialCommentSortOrder=\{commentSortOrder\}/);
  assert.match(boardSource, /initialCommentSortOrder: CommentSortOrder/);
  assert.match(boardSource, /commentSortStore\.hydrate\(initialCommentSortOrder/);
});
