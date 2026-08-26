import { createServerFn } from "@tanstack/react-start";

import {
  readWorkspaceTemplates,
  writeWorkspaceTemplates,
  type CardTemplate,
} from "./workspace/templates-repository";

function workspaceRoot() {
  return process.env.FLOWMARK_WORKSPACE_ROOT ?? process.cwd();
}

export const getTemplatesFile = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ path: string; json: string; locale: string; timeZone: string }> => {
    const result = await readWorkspaceTemplates(workspaceRoot());
    return {
      path: result.path,
      locale: result.locale,
      timeZone: result.timeZone,
      json: `${JSON.stringify(result.templates, null, 2)}\n`,
    };
  },
);

export const saveTemplatesFile = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    if (!data || typeof data !== "object" || typeof (data as { json?: unknown }).json !== "string")
      throw new Error("Expected { json: string }");
    const deletedIds = (data as { deletedIds?: unknown }).deletedIds;
    if (deletedIds !== undefined && !Array.isArray(deletedIds))
      throw new Error("deletedIds must be a string array.");
    return {
      json: (data as { json: string }).json,
      deletedIds: (deletedIds ?? []) as string[],
    };
  })
  .handler(async ({ data }): Promise<{ path: string; ok: true }> => {
    const templates = JSON.parse(data.json) as CardTemplate[];
    if (!Array.isArray(templates)) throw new Error("Templates must be a JSON array.");
    const result = await writeWorkspaceTemplates(workspaceRoot(), {
      templates,
      deletedIds: data.deletedIds,
    });
    return { path: result.path, ok: true };
  });
