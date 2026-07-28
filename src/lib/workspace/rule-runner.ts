import { Cron } from "croner";

import type { Board, Card } from "../types";
import { calendarDateAtOffset } from "../calendar-date";
import { applyRuleTransaction, dueState, type RuleEvent } from "../rule-engine";
import { readWorkspaceBoard, writeWorkspaceBoard } from "./board-repository";
import { readWorkspaceRules } from "./rules-repository";
import { validateWorkspace } from "./validator";

type SourceValue = Record<string, unknown>;

function isRecord(value: unknown): value is SourceValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function ageDays(value: string | null, now: Date) {
  if (!value) return null;
  return Math.floor((now.getTime() - new Date(value).getTime()) / 86_400_000);
}

function compare(actual: number, operator: unknown, expected: unknown) {
  if (typeof expected !== "number") return false;
  if (operator === "greater_than") return actual > expected;
  if (operator === "less_than") return actual < expected;
  if (operator === "less_than_or_equal") return actual <= expected;
  if (operator === "equal") return actual === expected;
  return actual >= expected;
}

function matchesCondition(
  board: Board,
  card: Card,
  condition: SourceValue,
  now: Date,
  timeZone: string,
) {
  switch (condition.type) {
    case "completed":
      return card.completed === condition.value;
    case "completed_age_days": {
      const age = ageDays(card.completedAt, now);
      return age !== null && compare(age, condition.operator, condition.value);
    }
    case "created_age_days": {
      const age = ageDays(card.createdAt, now);
      return age !== null && compare(age, condition.operator, condition.value);
    }
    case "column": {
      const columnId = board.columns.find((column) => column.cardIds.includes(card.id))?.id;
      if (typeof condition.column_id === "string") return columnId === condition.column_id;
      if (!Array.isArray(condition.column_ids)) return false;
      const included = condition.column_ids.includes(columnId);
      return condition.operator === "not_in" ? !included : included;
    }
    case "tag":
      return typeof (condition.tag_id ?? condition.value) === "string"
        ? card.tagIds.includes(String(condition.tag_id ?? condition.value))
        : false;
    case "due_state":
      return dueState(card, now, timeZone) === condition.value;
    default:
      return false;
  }
}

function applyAction(board: Board, card: Card, action: SourceValue, now: Date, timeZone: string) {
  switch (action.type) {
    case "move_card": {
      if (typeof action.column_id !== "string") return false;
      const target = board.columns.find((column) => column.id === action.column_id);
      if (!target) return false;
      if (target.cardIds.includes(card.id)) return false;
      for (const column of board.columns)
        column.cardIds = column.cardIds.filter((id) => id !== card.id);
      target.cardIds.push(card.id);
      return true;
    }
    case "set_due_date": {
      const next = calendarDateAtOffset(now, Number(action.offset_days ?? 0), timeZone);
      if (card.dueDate === next) return false;
      card.dueDate = next;
      return true;
    }
    case "clear_due_date":
      if (card.dueDate === null) return false;
      card.dueDate = null;
      return true;
    case "add_tag":
      if (typeof action.tag_id !== "string") return false;
      if (card.tagIds.includes(action.tag_id)) return false;
      card.tagIds.push(action.tag_id);
      return true;
    case "remove_tag":
      if (typeof action.tag_id !== "string") return false;
      if (!card.tagIds.includes(action.tag_id)) return false;
      card.tagIds = card.tagIds.filter((id) => id !== action.tag_id);
      return true;
    case "mark_completed":
      if (card.completed) return false;
      card.completed = true;
      card.completedAt ??= now.toISOString();
      return true;
    case "mark_uncompleted":
      if (!card.completed) return false;
      card.completed = false;
      card.completedAt = null;
      return true;
    case "archive_card":
      if (!board.cards[card.id]) return false;
      delete board.cards[card.id];
      for (const column of board.columns)
        column.cardIds = column.cardIds.filter((id) => id !== card.id);
      return true;
    default:
      return false;
  }
}

function sortCardsByDueDate(board: Board) {
  let changed = false;
  for (const column of board.columns) {
    const originalOrder = new Map(column.cardIds.map((cardId, index) => [cardId, index]));
    const sorted = [...column.cardIds].sort((leftId, rightId) => {
      const left = board.cards[leftId]?.dueDate ?? null;
      const right = board.cards[rightId]?.dueDate ?? null;
      if (left === right)
        return (originalOrder.get(leftId) ?? 0) - (originalOrder.get(rightId) ?? 0);
      if (left === null) return 1;
      if (right === null) return -1;
      return left.localeCompare(right);
    });
    if (sorted.some((cardId, index) => cardId !== column.cardIds[index])) {
      column.cardIds = sorted;
      changed = true;
    }
  }
  return changed;
}

function cardColumnId(board: Board, cardId: string) {
  return board.columns.find((column) => column.cardIds.includes(cardId))?.id ?? null;
}

export async function runScheduledRule(root: string, ruleId: string, now = new Date()) {
  const validation = await validateWorkspace(root);
  if (validation.errors.length > 0 || !validation.workspace)
    throw new Error(`Cannot run rules for an invalid workspace.`);
  const rule = validation.workspace.rules.get(ruleId);
  if (!rule || rule.enabled !== true || !isRecord(rule.trigger) || rule.trigger.type !== "schedule")
    return 0;
  const conditions = Array.isArray(rule.conditions) ? rule.conditions.filter(isRecord) : [];
  const actions = Array.isArray(rule.actions) ? rule.actions.filter(isRecord) : [];
  const workspace = isRecord(validation.workspace.workspace.workspace)
    ? validation.workspace.workspace.workspace
    : {};
  const timeZone =
    typeof rule.trigger.timezone === "string"
      ? rule.trigger.timezone
      : typeof workspace.timezone === "string"
        ? workspace.timezone
        : "UTC";
  let board = await readWorkspaceBoard(root);
  let affected = 0;
  let sortRequested = false;
  const derivedEvents: RuleEvent[] = [];
  for (const card of Object.values(board.cards)) {
    if (!conditions.every((condition) => matchesCondition(board, card, condition, now, timeZone)))
      continue;
    let changed = false;
    for (const action of actions) {
      if (action.type === "sort_cards") sortRequested = true;
      else {
        const beforeColumn = cardColumnId(board, card.id);
        const beforeDueDate = card.dueDate;
        const beforeCompleted = card.completed;
        const actionChanged = applyAction(board, card, action, now, timeZone);
        changed = actionChanged || changed;
        if (!actionChanged || !board.cards[card.id]) continue;
        const afterColumn = cardColumnId(board, card.id);
        if (beforeColumn && afterColumn && beforeColumn !== afterColumn)
          derivedEvents.push({
            kind: "card.moved",
            cardId: card.id,
            fromColumnId: beforeColumn,
            toColumnId: afterColumn,
          });
        if (beforeDueDate !== card.dueDate)
          derivedEvents.push({ kind: "card.dueStateChanged", cardId: card.id });
        if (beforeCompleted !== card.completed)
          derivedEvents.push({
            kind: "card.completed",
            cardId: card.id,
            completed: card.completed,
          });
      }
    }
    if (changed) affected++;
  }
  if (derivedEvents.length > 0) {
    const eventRules = await readWorkspaceRules(root);
    const result = applyRuleTransaction({
      board,
      rules: eventRules.rules,
      events: derivedEvents,
      now,
      timeZone: eventRules.timeZone,
    });
    if (result.diagnostics.length > 0)
      throw new Error(
        `Scheduled rule cascade failed: ${result.diagnostics.map((item) => item.message).join(" ")}`,
      );
    board = result.board;
  }
  if (sortRequested && sortCardsByDueDate(board)) affected++;
  if (affected > 0) await writeWorkspaceBoard(root, board);
  return affected;
}

export async function reconcileWorkspaceRules(root: string, now = new Date()) {
  const [{ rules, timeZone }, board] = await Promise.all([
    readWorkspaceRules(root),
    readWorkspaceBoard(root),
  ]);
  const result = applyRuleTransaction({
    board,
    rules,
    events: Object.values(board.cards).flatMap((card) => [
      ...(card.completed
        ? [{ kind: "card.completed" as const, cardId: card.id, completed: true as const }]
        : []),
      { kind: "card.dueStateChanged" as const, cardId: card.id },
    ]),
    now,
    timeZone,
  });
  if (result.diagnostics.length > 0) {
    return { ...result, board, changed: false };
  }
  if (result.changed) await writeWorkspaceBoard(root, result.board);
  return result;
}

export function nextWorkspaceMidnight(now: Date, timeZone: string): Date {
  const next = new Cron("0 0 * * *", { timezone: timeZone, paused: true }).nextRun(now);
  if (!next) throw new Error(`Cannot calculate the next midnight for ${timeZone}.`);
  return next;
}

export async function startWorkspaceJobs(
  root: string,
  options: { now?: () => Date } = {},
): Promise<() => void> {
  const validation = await validateWorkspace(root);
  if (validation.errors.length > 0 || !validation.workspace)
    throw new Error(`Cannot start jobs for an invalid workspace.`);
  const workspace = isRecord(validation.workspace.workspace.workspace)
    ? validation.workspace.workspace.workspace
    : {};
  const workspaceTimeZone = typeof workspace.timezone === "string" ? workspace.timezone : "UTC";
  const reconciliation = await reconcileWorkspaceRules(root, (options.now ?? (() => new Date()))());
  for (const diagnostic of reconciliation.diagnostics) {
    console.error(`Workspace rule reconciliation ${diagnostic.code}: ${diagnostic.message}`);
  }
  const jobs: Cron[] = [];
  jobs.push(
    new Cron(
      "0 0 * * *",
      {
        timezone: workspaceTimeZone,
        protect: true,
        catch: (error) => console.error("Workspace midnight reconciliation failed:", error),
      },
      async () => {
        await reconcileWorkspaceRules(root);
      },
    ),
  );
  for (const rule of validation.workspace.rules.values()) {
    if (rule.enabled !== true || !isRecord(rule.trigger) || rule.trigger.type !== "schedule")
      continue;
    if (typeof rule.trigger.cron !== "string") continue;
    jobs.push(
      new Cron(
        rule.trigger.cron,
        {
          timezone: typeof rule.trigger.timezone === "string" ? rule.trigger.timezone : undefined,
          protect: true,
          catch: (error) => console.error(`Scheduled rule ${rule.id} failed:`, error),
        },
        async () => {
          await runScheduledRule(root, rule.id);
        },
      ),
    );
  }
  return () => {
    for (const job of jobs) job.stop();
  };
}
