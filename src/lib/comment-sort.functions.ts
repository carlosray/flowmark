import { createServerFn } from "@tanstack/react-start";

import {
  readCommentSortOrder,
  writeCommentSortOrder,
  type CommentSortOrder,
} from "./workspace/runtime-preferences";

function workspaceRoot() {
  return process.env.FLOWMARK_WORKSPACE_ROOT ?? process.cwd();
}

function isCommentSortOrder(value: unknown): value is CommentSortOrder {
  return value === "descending" || value === "ascending";
}

export const getCommentSortOrder = createServerFn({ method: "GET" }).handler(async () =>
  readCommentSortOrder(workspaceRoot()),
);

export const saveCommentSortOrder = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    if (!data || typeof data !== "object" || !("order" in data) || !isCommentSortOrder(data.order))
      throw new Error("Expected { order: 'descending' | 'ascending' }");
    return { order: data.order };
  })
  .handler(async ({ data }) => {
    await writeCommentSortOrder(workspaceRoot(), data.order);
    return { ok: true as const };
  });
