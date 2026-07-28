import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseDocument } from "yaml";

import { DEFAULT_THEME, isThemeId, type ThemeId } from "../themes";
import { FileMutation, rollbackAndRethrow } from "./file-transaction";
import { validateWorkspace } from "./validator";

function validationMessage(result: Awaited<ReturnType<typeof validateWorkspace>>) {
  return result.errors.map((error) => `${error.code}: ${error.message}`).join("\n");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function readWorkspaceTheme(root: string): Promise<ThemeId> {
  const result = await validateWorkspace(root);
  if (result.errors.length > 0 || !result.workspace)
    throw new Error(validationMessage(result) || "Workspace validation failed.");
  const ui = asRecord(result.workspace.workspace.ui);
  return isThemeId(ui.theme) ? ui.theme : DEFAULT_THEME;
}

export async function writeWorkspaceTheme(root: string, theme: ThemeId): Promise<void> {
  if (!isThemeId(theme)) throw new Error(`Invalid theme ID: ${String(theme)}`);

  const before = await validateWorkspace(root);
  if (before.errors.length > 0)
    throw new Error(validationMessage(before) || "Workspace validation failed.");

  const filePath = join(root, "flowmark.yaml");
  const original = await readFile(filePath, "utf8");
  const document = parseDocument(original);
  if (document.errors.length > 0) throw new Error(document.errors.map(String).join("\n"));
  document.setIn(["ui", "theme"], theme);

  const transaction = new FileMutation();
  try {
    await transaction.write(filePath, String(document));
    const after = await validateWorkspace(root);
    if (after.errors.length > 0)
      throw new Error(
        validationMessage(after) || "Workspace validation failed after saving theme.",
      );
    transaction.commit();
  } catch (error) {
    await rollbackAndRethrow(transaction, error);
  }
}
