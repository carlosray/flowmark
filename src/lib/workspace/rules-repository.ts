import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { stringify } from "yaml";

import {
  RULE_ID_PATTERN,
  type DueState,
  type DueWhen,
  type Rule,
  type RuleAction,
  type RuleCondition,
  type RuleTrigger,
} from "../rule-model";
import { FileMutation, rollbackAndRethrow } from "./file-transaction";
import { validateWorkspace } from "./validator";

type SourceValue = Record<string, unknown>;

export interface RulesWriteRequest {
  rules: Rule[];
  deletedIds: string[];
}

function asRecord(value: unknown): SourceValue {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as SourceValue)
    : {};
}

function sourceFields(value: SourceValue | undefined) {
  if (!value) return {};
  const { __filePath: _internalPath, ...source } = value;
  return source;
}

function conditionsOf(source: SourceValue): SourceValue[] {
  if (source.conditions === undefined) return [];
  return Array.isArray(source.conditions) ? source.conditions.map(asRecord) : [];
}

function uiTrigger(source: SourceValue): { trigger: RuleTrigger; consumed: Set<number> } | null {
  const trigger = asRecord(source.trigger);
  const conditions = conditionsOf(source);
  switch (trigger.type) {
    case "card_created": {
      const columnIndex = conditions.findIndex(
        (condition) => condition.type === "column" && typeof condition.column_id === "string",
      );
      return {
        trigger: {
          kind: "card.created",
          columnId: columnIndex >= 0 ? (conditions[columnIndex].column_id as string) : "*",
        },
        consumed: new Set(columnIndex >= 0 ? [columnIndex] : []),
      };
    }
    case "card_entered_column":
      return typeof trigger.column_id === "string"
        ? {
            trigger: { kind: "card.moved", toColumnId: trigger.column_id },
            consumed: new Set(),
          }
        : null;
    case "card_completed":
      return { trigger: { kind: "card.completed", value: true }, consumed: new Set() };
    case "card_uncompleted":
      return { trigger: { kind: "card.completed", value: false }, consumed: new Set() };
    case "due_date_reached": {
      const dueIndex = conditions.findIndex((condition) => condition.type === "due_state");
      const value = conditions[dueIndex]?.value;
      return dueIndex >= 0 && (value === "overdue" || value === "today" || value === "tomorrow")
        ? { trigger: { kind: "card.dueOn", when: value }, consumed: new Set([dueIndex]) }
        : null;
    }
    case "due_state_changed":
      return { trigger: { kind: "card.dueStateChanged" }, consumed: new Set() };
    default:
      return null;
  }
}

function uiCondition(source: SourceValue): RuleCondition | null {
  switch (source.type) {
    case "column":
      if (typeof source.column_id === "string")
        return { kind: "column", operator: "in", columnIds: [source.column_id] };
      return (source.operator === "in" || source.operator === "not_in") &&
        Array.isArray(source.column_ids) &&
        source.column_ids.every((columnId) => typeof columnId === "string")
        ? {
            kind: "column",
            operator: source.operator,
            columnIds: source.column_ids as string[],
          }
        : null;
    case "tag":
      return typeof source.tag_id === "string" ? { kind: "tag", tagId: source.tag_id } : null;
    case "completed":
      return typeof source.value === "boolean" ? { kind: "completed", value: source.value } : null;
    case "due_state":
      return ["none", "overdue", "today", "tomorrow", "future"].includes(String(source.value))
        ? { kind: "dueState", value: source.value as DueState }
        : null;
    case "created_age_days":
    case "completed_age_days":
      if (
        typeof source.value !== "number" ||
        source.value < 0 ||
        (source.operator !== undefined && source.operator !== "greater_than_or_equal")
      )
        return null;
      return source.type === "created_age_days"
        ? { kind: "createdAgeDays", value: source.value }
        : { kind: "completedAgeDays", value: source.value };
    default:
      return null;
  }
}

function uiAction(source: SourceValue): RuleAction | null {
  switch (source.type) {
    case "set_due_date":
      if (source.mode === "end_of_day") return { kind: "setDueDate", offsetDays: 0 };
      return source.mode === "offset" && typeof source.offset_days === "number"
        ? { kind: "setDueDate", offsetDays: source.offset_days }
        : null;
    case "clear_due_date":
      return { kind: "clearDueDate" };
    case "add_tag":
      return typeof source.tag_id === "string" ? { kind: "addTag", tagId: source.tag_id } : null;
    case "remove_tag":
      return typeof source.tag_id === "string" ? { kind: "removeTag", tagId: source.tag_id } : null;
    case "move_card":
      return typeof source.column_id === "string"
        ? { kind: "moveToColumn", columnId: source.column_id }
        : null;
    case "mark_completed":
      return { kind: "setCompleted", value: true };
    case "mark_uncompleted":
      return { kind: "setCompleted", value: false };
    case "sort_cards":
      return source.scope === "all_columns" &&
        source.by === "due_at" &&
        source.direction === "ascending" &&
        source.nulls === "last"
        ? { kind: "sortByDueDate" }
        : null;
    case "archive_card":
      return { kind: "archiveCard" };
    default:
      return null;
  }
}

function uiRule(source: SourceValue): Rule | null {
  const triggerResult = uiTrigger(source);
  const sourceConditions = conditionsOf(source);
  const conditions = sourceConditions
    .filter((_, index) => !triggerResult?.consumed.has(index))
    .map(uiCondition);
  const sourceActions = Array.isArray(source.actions) ? source.actions.map(asRecord) : [];
  const actions = sourceActions.map(uiAction);
  if (
    !triggerResult ||
    conditions.some((condition) => condition === null) ||
    sourceActions.length === 0 ||
    actions.some((action) => action === null) ||
    typeof source.id !== "string" ||
    typeof source.name !== "string" ||
    typeof source.enabled !== "boolean"
  )
    return null;
  return {
    id: source.id,
    name: source.name,
    enabled: source.enabled,
    trigger: triggerResult.trigger,
    ...(conditions.length > 0 ? { conditions: conditions as RuleCondition[] } : {}),
    actions: actions as RuleAction[],
  };
}

function sourceTrigger(trigger: RuleTrigger): SourceValue {
  switch (trigger.kind) {
    case "card.created":
      return { type: "card_created" };
    case "card.moved":
      return { type: "card_entered_column", column_id: trigger.toColumnId };
    case "card.completed":
      return { type: trigger.value ? "card_completed" : "card_uncompleted" };
    case "card.dueOn":
      return { type: "due_date_reached" };
    case "card.dueStateChanged":
      return { type: "due_state_changed" };
  }
}

function sourceCondition(condition: RuleCondition): SourceValue {
  switch (condition.kind) {
    case "column":
      return {
        type: "column",
        operator: condition.operator,
        column_ids: condition.columnIds,
      };
    case "tag":
      return { type: "tag", tag_id: condition.tagId };
    case "completed":
      return { type: "completed", value: condition.value };
    case "dueState":
      return { type: "due_state", value: condition.value };
    case "createdAgeDays":
      return {
        type: "created_age_days",
        operator: "greater_than_or_equal",
        value: condition.value,
      };
    case "completedAgeDays":
      return {
        type: "completed_age_days",
        operator: "greater_than_or_equal",
        value: condition.value,
      };
  }
}

function sourceConditions(rule: Rule): SourceValue[] | undefined {
  const conditions: SourceValue[] = [];
  const trigger = rule.trigger;
  if (trigger.kind === "card.created" && trigger.columnId !== "*")
    conditions.push({ type: "column", column_id: trigger.columnId });
  if (trigger.kind === "card.dueOn")
    conditions.push({ type: "due_state", value: trigger.when satisfies DueWhen });
  conditions.push(...(rule.conditions ?? []).map(sourceCondition));
  return conditions.length > 0 ? conditions : undefined;
}

function sourceAction(action: RuleAction): SourceValue {
  switch (action.kind) {
    case "setDueDate":
      return { type: "set_due_date", mode: "offset", offset_days: action.offsetDays };
    case "clearDueDate":
      return { type: "clear_due_date" };
    case "addTag":
      return { type: "add_tag", tag_id: action.tagId };
    case "removeTag":
      return { type: "remove_tag", tag_id: action.tagId };
    case "moveToColumn":
      return { type: "move_card", column_id: action.columnId };
    case "setCompleted":
      return { type: action.value ? "mark_completed" : "mark_uncompleted" };
    case "sortByDueDate":
      return {
        type: "sort_cards",
        scope: "all_columns",
        by: "due_at",
        direction: "ascending",
        nulls: "last",
      };
    case "archiveCard":
      return { type: "archive_card" };
  }
}

function validateUiRule(rule: Rule, columns: Set<string>, tags: Set<string>) {
  if (!RULE_ID_PATTERN.test(rule.id)) throw new Error(`Invalid rule ID: ${rule.id}`);
  if (!rule.name.trim()) throw new Error(`Rule ${rule.id} must have a name.`);
  if (rule.actions.length === 0)
    throw new Error(`Rule ${rule.id} must contain at least one action.`);
  if (rule.trigger.kind === "card.created" && rule.trigger.columnId !== "*") {
    if (!columns.has(rule.trigger.columnId))
      throw new Error(`Rule ${rule.id} references missing column ${rule.trigger.columnId}.`);
  }
  if (rule.trigger.kind === "card.moved" && !columns.has(rule.trigger.toColumnId))
    throw new Error(`Rule ${rule.id} references missing column ${rule.trigger.toColumnId}.`);
  for (const condition of rule.conditions ?? []) {
    if (condition.kind === "column")
      for (const columnId of condition.columnIds)
        if (!columns.has(columnId))
          throw new Error(`Rule ${rule.id} references missing column ${columnId}.`);
    if (condition.kind === "tag" && !tags.has(condition.tagId))
      throw new Error(`Rule ${rule.id} references missing tag ${condition.tagId}.`);
  }
  for (const action of rule.actions) {
    if (
      rule.trigger.kind === "card.moved" &&
      action.kind === "moveToColumn" &&
      action.columnId === rule.trigger.toColumnId
    )
      throw new Error(`Rule ${rule.id} would self-trigger by moving a card into the same column.`);
    if (action.kind === "moveToColumn" && !columns.has(action.columnId))
      throw new Error(`Rule ${rule.id} references missing column ${action.columnId}.`);
    if ((action.kind === "addTag" || action.kind === "removeTag") && !tags.has(action.tagId))
      throw new Error(`Rule ${rule.id} references missing tag ${action.tagId}.`);
  }
}

function validationMessage(result: Awaited<ReturnType<typeof validateWorkspace>>) {
  return result.errors.map((error) => `${error.code}: ${error.message}`).join("\n");
}

export async function readWorkspaceRules(
  root: string,
): Promise<{ path: string; timeZone: string; rules: Rule[] }> {
  const result = await validateWorkspace(root);
  if (result.errors.length > 0 || !result.workspace)
    throw new Error(validationMessage(result) || "Workspace validation failed.");
  const paths = asRecord(result.workspace.workspace.paths);
  const workspace = asRecord(result.workspace.workspace.workspace);
  const rules = [...result.workspace.rules.values()]
    .map((source) => uiRule(source))
    .filter((rule): rule is Rule => rule !== null);
  return {
    path: join(root, String(paths.rules)),
    timeZone: String(workspace.timezone),
    rules,
  };
}

export async function writeWorkspaceRules(
  root: string,
  request: RulesWriteRequest,
  now = new Date(),
): Promise<{ path: string }> {
  const before = await validateWorkspace(root);
  if (before.errors.length > 0 || !before.workspace)
    throw new Error(validationMessage(before) || "Workspace validation failed.");

  const ids = new Set<string>();
  const columns = new Set(before.workspace.columns.keys());
  const tags = new Set(before.workspace.tags.keys());
  for (const rule of request.rules) {
    validateUiRule(rule, columns, tags);
    if (ids.has(rule.id)) throw new Error(`Duplicate rule ID: ${rule.id}`);
    ids.add(rule.id);
  }

  const editorRules = new Map<string, Rule>();
  for (const source of before.workspace.rules.values()) {
    const mapped = uiRule(source);
    if (mapped) editorRules.set(mapped.id, mapped);
  }
  for (const id of request.deletedIds) {
    if (!RULE_ID_PATTERN.test(id)) throw new Error(`Invalid rule ID: ${id}`);
    if (!editorRules.has(id)) throw new Error(`Rule ${id} is not managed by the visual editor.`);
    if (ids.has(id)) throw new Error(`Rule ${id} cannot be saved and deleted together.`);
  }

  const paths = asRecord(before.workspace.workspace.paths);
  const rulesDir = join(root, String(paths.rules));
  await mkdir(rulesDir, { recursive: true });
  const transaction = new FileMutation();
  try {
    for (const rule of request.rules) {
      const existing = before.workspace.rules.get(rule.id);
      const existingUi = existing ? uiRule(existing) : null;
      if (existingUi && JSON.stringify(existingUi) === JSON.stringify(rule)) continue;
      const conditions = sourceConditions(rule);
      await transaction.write(
        join(rulesDir, `${rule.id}.yaml`),
        stringify({
          ...sourceFields(existing),
          schema_version: 1,
          id: rule.id,
          name: rule.name,
          enabled: rule.enabled,
          trigger: sourceTrigger(rule.trigger),
          conditions,
          actions: rule.actions.map(sourceAction),
          created_at: existing?.created_at ?? now.toISOString(),
          updated_at: now.toISOString(),
        }),
      );
    }
    for (const id of request.deletedIds) await transaction.remove(join(rulesDir, `${id}.yaml`));

    const after = await validateWorkspace(root);
    if (after.errors.length > 0)
      throw new Error(
        validationMessage(after) || "Workspace validation failed after saving rules.",
      );
    transaction.commit();
  } catch (error) {
    await rollbackAndRethrow(transaction, error);
  }
  return { path: rulesDir };
}
