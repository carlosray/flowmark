/**
 * Tracks how far each scheduled rule has been processed, and works out what was
 * missed while Flowmark was not running.
 *
 * The watermark in `.flowmark/` is disposable. Losing it costs at most a repeat
 * of the questions the user already answered, never a duplicate card: the cards
 * themselves carry the canonical `origin.occurrence` the rebuild reads.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "yaml";

import { renderTemplateText } from "../template-expression";
import { occurrencesBetween, parseScheduleTrigger, type ScheduleTrigger } from "./schedule";
import { validateWorkspace, type WorkspaceSnapshot } from "./validator";

type SourceValue = Record<string, unknown>;

/** Above this many missed runs the prompt asks once about the whole series. */
export const PENDING_SERIES_THRESHOLD = 20;

export interface PendingSeries {
  ruleId: string;
  ruleName: string;
  templateId: string;
  /** Missed occurrence instants, oldest first. */
  occurrences: string[];
  /** Rendered titles aligned with `occurrences`; empty for a collapsed series. */
  previews: string[];
  collapsed: boolean;
}

export interface ScheduledCreation {
  ruleId: string;
  ruleName: string;
  templateId: string;
  columnIdOverride: string | null;
  trigger: ScheduleTrigger;
  createdAt: string;
  timeZone: string;
}

function asRecord(value: unknown): SourceValue {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as SourceValue)
    : {};
}

function systemDirectory(snapshot: WorkspaceSnapshot) {
  const paths = asRecord(snapshot.workspace.paths);
  return typeof paths.system === "string" ? paths.system : ".flowmark";
}

function jobsPath(root: string, systemDir: string, ruleId: string) {
  return join(root, systemDir, "jobs", `${ruleId}.yaml`);
}

async function snapshotOf(root: string): Promise<WorkspaceSnapshot> {
  const result = await validateWorkspace(root);
  if (result.errors.length > 0 || !result.workspace)
    throw new Error(
      result.errors.map((error) => `${error.code}: ${error.message}`).join("\n") ||
        "Workspace validation failed.",
    );
  return result.workspace;
}

export async function readWatermark(root: string, ruleId: string): Promise<string | null> {
  const snapshot = await snapshotOf(root);
  return readWatermarkFrom(root, systemDirectory(snapshot), ruleId);
}

async function readWatermarkFrom(
  root: string,
  systemDir: string,
  ruleId: string,
): Promise<string | null> {
  try {
    const parsed = asRecord(parse(await readFile(jobsPath(root, systemDir, ruleId), "utf8")));
    const value = parsed.last_processed;
    return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeWatermark(root: string, ruleId: string, occurrence: string) {
  const snapshot = await snapshotOf(root);
  const systemDir = systemDirectory(snapshot);
  const path = jobsPath(root, systemDir, ruleId);
  await mkdir(join(root, systemDir, "jobs"), { recursive: true });
  await writeFile(path, stringify({ last_processed: occurrence }), "utf8");
}

/** The newest occurrence this rule is known to have produced a card for. */
export function latestOriginOccurrence(snapshot: WorkspaceSnapshot, ruleId: string): string | null {
  let latest: string | null = null;
  for (const card of snapshot.cards.values()) {
    const origin = asRecord(card.source.origin);
    if (origin.rule_id !== ruleId) continue;
    const occurrence = origin.occurrence;
    if (typeof occurrence !== "string") continue;
    if (latest === null || Date.parse(occurrence) > Date.parse(latest)) latest = occurrence;
  }
  return latest;
}

function resolveWatermarkFrom(
  stored: string | null,
  snapshot: WorkspaceSnapshot,
  ruleId: string,
  ruleCreatedAt: string,
): string {
  return stored ?? latestOriginOccurrence(snapshot, ruleId) ?? ruleCreatedAt;
}

export async function resolveWatermark(
  root: string,
  ruleId: string,
  ruleCreatedAt: string,
): Promise<string> {
  const snapshot = await snapshotOf(root);
  const stored = await readWatermarkFrom(root, systemDirectory(snapshot), ruleId);
  return resolveWatermarkFrom(stored, snapshot, ruleId, ruleCreatedAt);
}

/**
 * Every enabled rule whose schedule creates cards. Scheduled rules that only
 * act on existing cards are excluded deliberately: replaying a missed
 * `archive_card` days later would act on a board that has since moved on.
 */
export function scheduledCreations(snapshot: WorkspaceSnapshot): ScheduledCreation[] {
  const workspace = asRecord(snapshot.workspace.workspace);
  const workspaceTimeZone = typeof workspace.timezone === "string" ? workspace.timezone : "UTC";
  const creations: ScheduledCreation[] = [];
  for (const rule of snapshot.rules.values()) {
    if (rule.enabled !== true) continue;
    const trigger = parseScheduleTrigger(rule.trigger);
    if (!trigger) continue;
    const actions = Array.isArray(rule.actions) ? rule.actions.map(asRecord) : [];
    const action = actions.find((candidate) => candidate.type === "create_card");
    if (!action || typeof action.template_id !== "string") continue;
    creations.push({
      ruleId: String(rule.id),
      ruleName: typeof rule.name === "string" ? rule.name : String(rule.id),
      templateId: action.template_id,
      columnIdOverride: typeof action.column_id === "string" ? action.column_id : null,
      trigger,
      createdAt: typeof rule.created_at === "string" ? rule.created_at : new Date(0).toISOString(),
      timeZone: trigger.timezone ?? workspaceTimeZone,
    });
  }
  return creations;
}

function previewTitles(
  snapshot: WorkspaceSnapshot,
  creation: ScheduledCreation,
  occurrences: Date[],
): string[] {
  const template = snapshot.templates.get(creation.templateId);
  const card = asRecord(template?.card);
  const title = typeof card.title === "string" ? card.title : "";
  const ui = asRecord(snapshot.workspace.ui);
  const locale = typeof ui.locale === "string" ? ui.locale : "en";
  return occurrences.map((occurrence) =>
    renderTemplateText(title, {
      occurrence,
      dueDate: null,
      timeZone: creation.timeZone,
      locale,
    }),
  );
}

/**
 * Missed runs, grouped per rule. An occurrence that arrives while the server is
 * running is created directly by the runner and never reaches this queue.
 */
export async function pendingOccurrences(root: string, now = new Date()): Promise<PendingSeries[]> {
  const snapshot = await snapshotOf(root);
  const systemDir = systemDirectory(snapshot);
  const series: PendingSeries[] = [];
  for (const creation of scheduledCreations(snapshot)) {
    const stored = await readWatermarkFrom(root, systemDir, creation.ruleId);
    const watermark = resolveWatermarkFrom(stored, snapshot, creation.ruleId, creation.createdAt);
    const occurrences = occurrencesBetween(
      creation.trigger,
      new Date(watermark),
      now,
      creation.timeZone,
    );
    if (occurrences.length === 0) continue;
    const collapsed = occurrences.length > PENDING_SERIES_THRESHOLD;
    series.push({
      ruleId: creation.ruleId,
      ruleName: creation.ruleName,
      templateId: creation.templateId,
      occurrences: occurrences.map((occurrence) => occurrence.toISOString()),
      previews: collapsed ? [] : previewTitles(snapshot, creation, occurrences),
      collapsed,
    });
  }
  return series;
}
