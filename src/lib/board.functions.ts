import { createServerFn } from "@tanstack/react-start";

import type { Board } from "./types";
import { readWorkspaceBoard, writeWorkspaceBoard } from "./workspace/board-repository";

function workspaceRoot() {
  return process.env.FLOWMARK_WORKSPACE_ROOT ?? process.cwd();
}

export const readWorkspace = createServerFn({ method: "GET" }).handler(async () => {
  const root = workspaceRoot();
  return { path: root, board: await readWorkspaceBoard(root) };
});

export const saveWorkspace = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    if (!data || typeof data !== "object" || !("board" in data)) {
      throw new Error("Expected { board: Board }");
    }
    return data as { board: Board };
  })
  .handler(async ({ data }) => {
    const root = workspaceRoot();
    await writeWorkspaceBoard(root, data.board);
    return { path: root, ok: true as const };
  });
