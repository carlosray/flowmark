import { createServerFn } from "@tanstack/react-start";

import type { Rule } from "./rule-model";
import { readWorkspaceRules, writeWorkspaceRules } from "./workspace/rules-repository";

function workspaceRoot() {
  return process.env.FLOWMARK_WORKSPACE_ROOT ?? process.cwd();
}

export const getRulesFile = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ path: string; timeZone: string; json: string }> => {
    const result = await readWorkspaceRules(workspaceRoot());
    return {
      path: result.path,
      timeZone: result.timeZone,
      json: `${JSON.stringify(result.rules, null, 2)}\n`,
    };
  },
);

export const saveRulesFile = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    if (
      !data ||
      typeof data !== "object" ||
      typeof (data as { json?: unknown }).json !== "string"
    ) {
      throw new Error("Expected { json: string }");
    }
    const deletedIds = (data as { deletedIds?: unknown }).deletedIds;
    if (deletedIds !== undefined && !Array.isArray(deletedIds))
      throw new Error("deletedIds must be a string array.");
    return {
      json: (data as { json: string }).json,
      deletedIds: (deletedIds ?? []) as string[],
    };
  })
  .handler(async ({ data }): Promise<{ path: string; ok: true }> => {
    const rules = JSON.parse(data.json) as Rule[];
    if (!Array.isArray(rules)) throw new Error("Rules must be a JSON array.");
    const result = await writeWorkspaceRules(workspaceRoot(), {
      rules,
      deletedIds: data.deletedIds,
    });
    return { path: result.path, ok: true };
  });
