import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isMap, parseDocument } from "yaml";

import { atomicWrite } from "./file-transaction";

const CARD_ID = /^card_[a-z0-9]+(?:_[a-z0-9]+)*$/;
const EXPANDED_CHECKLIST_PATH = ["ui", "expanded_checklist_card_ids"] as const;

function normalizeCardIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(value.filter((id): id is string => typeof id === "string" && CARD_ID.test(id))),
  ].sort();
}

function runtimePath(root: string) {
  return join(root, ".flowmark", "runtime.yaml");
}

export async function readExpandedChecklistCardIds(root: string): Promise<string[]> {
  try {
    const document = parseDocument(await readFile(runtimePath(root), "utf8"));
    if (document.errors.length > 0) return [];
    const value = document.toJS() as {
      ui?: { expanded_checklist_card_ids?: unknown };
    } | null;
    return normalizeCardIds(value?.ui?.expanded_checklist_card_ids);
  } catch {
    return [];
  }
}

export async function writeExpandedChecklistCardIds(
  root: string,
  cardIds: Iterable<string>,
): Promise<void> {
  const filePath = runtimePath(root);
  let document;
  try {
    document = parseDocument(await readFile(filePath, "utf8"));
    if (document.errors.length > 0 || !isMap(document.contents)) {
      document = parseDocument("{}\n");
    }
  } catch {
    document = parseDocument("{}\n");
  }

  document.setIn(EXPANDED_CHECKLIST_PATH, normalizeCardIds([...cardIds]));
  await mkdir(dirname(filePath), { recursive: true });
  await atomicWrite(filePath, String(document));
}
