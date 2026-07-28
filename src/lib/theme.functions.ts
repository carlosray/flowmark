import { createServerFn } from "@tanstack/react-start";

import { isThemeId } from "./themes";
import { readWorkspaceTheme, writeWorkspaceTheme } from "./workspace/theme-repository";

function workspaceRoot() {
  return process.env.FLOWMARK_WORKSPACE_ROOT ?? process.cwd();
}

export const getWorkspaceTheme = createServerFn({ method: "GET" }).handler(async () =>
  readWorkspaceTheme(workspaceRoot()),
);

export const saveWorkspaceTheme = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    if (!data || typeof data !== "object" || !("theme" in data) || !isThemeId(data.theme))
      throw new Error("Expected a supported { theme: ThemeId }");
    return { theme: data.theme };
  })
  .handler(async ({ data }) => {
    await writeWorkspaceTheme(workspaceRoot(), data.theme);
    return { ok: true as const, theme: data.theme };
  });
