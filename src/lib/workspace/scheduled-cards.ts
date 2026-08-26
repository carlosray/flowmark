/**
 * Creates the card a scheduled rule asks for.
 *
 * The card file is written directly rather than through the board projection,
 * because the projection has no place for the `origin` marker and that marker is
 * what makes a repeated run a no-op instead of a duplicate.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { stringify } from "yaml";

import { applyRuleTransaction, type RuleEvent } from "../rule-engine";
import { readWorkspaceBoard, writeWorkspaceBoard } from "./board-repository";
import { FileMutation, rollbackAndRethrow } from "./file-transaction";
import { readWorkspaceRules } from "./rules-repository";
import { scheduledCreations, writeWatermark, type ScheduledCreation } from "./schedule-state";
import { instantiateTemplate, type InstantiatedCard } from "./template-instantiation";
import { toCardTemplate } from "./templates-repository";
import { validateWorkspace, type WorkspaceSnapshot } from "./validator";

type SourceValue = Record<string, unknown>;

function asRecord(value: unknown): SourceValue {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as SourceValue)
    : {};
}

function validationMessage(result: Awaited<ReturnType<typeof validateWorkspace>>) {
  return result.errors.map((error) => `${error.code}: ${error.message}`).join("\n");
}

async function snapshotOf(root: string): Promise<WorkspaceSnapshot> {
  const result = await validateWorkspace(root);
  if (result.errors.length > 0 || !result.workspace)
    throw new Error(validationMessage(result) || "Workspace validation failed.");
  return result.workspace;
}

/** True when this rule already produced a card for this instant. */
export function occurrenceAlreadyCreated(
  snapshot: WorkspaceSnapshot,
  ruleId: string,
  occurrence: Date,
): boolean {
  const iso = occurrence.toISOString();
  for (const card of snapshot.cards.values()) {
    const origin = asRecord(card.source.origin);
    if (origin.rule_id !== ruleId || typeof origin.occurrence !== "string") continue;
    if (Date.parse(origin.occurrence) === Date.parse(iso)) return true;
  }
  return false;
}

function nextPosition(snapshot: WorkspaceSnapshot, columnId: string) {
  let highest = 0;
  for (const card of snapshot.cards.values())
    if (!card.archived && card.columnId === columnId) highest = Math.max(highest, card.position);
  return highest + 1024;
}

async function writeCardFiles(
  root: string,
  snapshot: WorkspaceSnapshot,
  card: InstantiatedCard,
  now: Date,
) {
  const paths = asRecord(snapshot.workspace.paths);
  const cardsDir = join(root, String(paths.cards));
  const checklistsDir = join(root, String(paths.checklists));
  await mkdir(cardsDir, { recursive: true });
  const checklistId =
    card.checklist.length > 0 ? `checklist_${card.cardId.slice("card_".length)}` : null;
  const timestamp = now.toISOString();

  const transaction = new FileMutation();
  try {
    if (checklistId) {
      await mkdir(checklistsDir, { recursive: true });
      await transaction.write(
        join(checklistsDir, `${checklistId}.yaml`),
        stringify({
          schema_version: 1,
          id: checklistId,
          card_id: card.cardId,
          title: "Checklist",
          position: 1024,
          created_at: timestamp,
          updated_at: timestamp,
          items: card.checklist.map((text, index) => ({
            id: `item_${card.cardId.slice("card_".length)}${index}`,
            text,
            completed: false,
            position: (index + 1) * 1024,
          })),
        }),
      );
    }
    const frontmatter = stringify({
      schema_version: 1,
      id: card.cardId,
      title: card.title,
      column_id: card.columnId,
      previous_column_id: null,
      position: nextPosition(snapshot, card.columnId),
      completed: false,
      completed_at: null,
      due_at: card.dueDate === null ? null : `${card.dueDate}T00:00:00Z`,
      tag_ids: card.tagIds,
      checklist_ids: checklistId ? [checklistId] : [],
      comment_ids: [],
      origin: card.origin,
      created_at: timestamp,
      updated_at: timestamp,
      archived_at: null,
    });
    await transaction.write(
      join(cardsDir, `${card.cardId}.md`),
      `---\n${frontmatter}---\n${card.body}`.replace(/\n*$/, "\n"),
    );
    const after = await validateWorkspace(root);
    if (after.errors.length > 0)
      throw new Error(
        validationMessage(after) || "Workspace validation failed after creating a card.",
      );
    transaction.commit();
  } catch (error) {
    await rollbackAndRethrow(transaction, error);
  }
}

/**
 * Lets the ordinary event rules act on the new card, which is how a card
 * created days ahead of its due date still lands in the right column.
 */
async function cascadeCreation(root: string, cardId: string, columnId: string, now: Date) {
  const [{ rules, timeZone }, board] = await Promise.all([
    readWorkspaceRules(root),
    readWorkspaceBoard(root),
  ]);
  if (!board.cards[cardId]) return;
  const events: RuleEvent[] = [
    { kind: "card.created", cardId, columnId },
    { kind: "card.dueStateChanged", cardId },
  ];
  const result = applyRuleTransaction({ board, rules, events, now, timeZone });
  if (result.diagnostics.length > 0)
    throw new Error(
      `Scheduled card creation cascade failed: ${result.diagnostics
        .map((item) => item.message)
        .join(" ")}`,
    );
  if (result.changed) await writeWorkspaceBoard(root, result.board);
}

function creationFor(snapshot: WorkspaceSnapshot, ruleId: string): ScheduledCreation | undefined {
  return scheduledCreations(snapshot).find((creation) => creation.ruleId === ruleId);
}

/**
 * Creates the card for one occurrence, or returns null when the rule no longer
 * creates cards or that occurrence already has its card.
 */
export async function createCardForOccurrence(
  root: string,
  ruleId: string,
  occurrence: Date,
  now = new Date(),
): Promise<string | null> {
  const snapshot = await snapshotOf(root);
  const creation = creationFor(snapshot, ruleId);
  if (!creation) return null;
  if (occurrenceAlreadyCreated(snapshot, ruleId, occurrence)) return null;

  const source = snapshot.templates.get(creation.templateId);
  if (!source) return null;
  const ui = asRecord(snapshot.workspace.ui);
  const defaults = asRecord(snapshot.workspace.defaults);
  const card = instantiateTemplate({
    template: toCardTemplate(source),
    ruleId,
    occurrence,
    timeZone: creation.timeZone,
    locale: typeof ui.locale === "string" ? ui.locale : "en",
    columnIdOverride: creation.columnIdOverride,
    defaultColumnId: String(defaults.initial_column_id),
  });

  await writeCardFiles(root, snapshot, card, now);
  await cascadeCreation(root, card.cardId, card.columnId, now);
  return card.cardId;
}

/**
 * Creates the card for an occurrence and records that the occurrence has been
 * dealt with, whether or not a card resulted.
 */
export async function processOccurrence(
  root: string,
  ruleId: string,
  occurrence: Date,
  options: { create: boolean; now?: Date } = { create: true },
): Promise<string | null> {
  const created = options.create
    ? await createCardForOccurrence(root, ruleId, occurrence, options.now ?? new Date())
    : null;
  await writeWatermark(root, ruleId, occurrence.toISOString());
  return created;
}
