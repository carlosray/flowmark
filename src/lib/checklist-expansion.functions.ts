import { createServerFn } from "@tanstack/react-start";

import {
  readExpandedChecklistCardIds,
  writeExpandedChecklistCardIds,
} from "./workspace/runtime-preferences";

const CARD_ID = /^card_[a-z0-9]+(?:_[a-z0-9]+)*$/;

function workspaceRoot() {
  return process.env.FLOWMARK_WORKSPACE_ROOT ?? process.cwd();
}

export const getExpandedChecklistCardIds = createServerFn({ method: "GET" }).handler(async () =>
  readExpandedChecklistCardIds(workspaceRoot()),
);

export const saveExpandedChecklistCardIds = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    if (
      !data ||
      typeof data !== "object" ||
      !("cardIds" in data) ||
      !Array.isArray(data.cardIds) ||
      !data.cardIds.every((id) => typeof id === "string" && CARD_ID.test(id))
    )
      throw new Error("Expected { cardIds: CardId[] }");
    return { cardIds: data.cardIds as string[] };
  })
  .handler(async ({ data }) => {
    await writeExpandedChecklistCardIds(workspaceRoot(), data.cardIds);
    return { ok: true as const };
  });
