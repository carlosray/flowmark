import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { Cron } from "croner";
import { parseDocument } from "yaml";

import {
  COLUMN_CONDITION_OPERATORS,
  DUE_STATES,
  RULE_ACTION_TYPES,
  RULE_CONDITION_TYPES,
  RULE_TRIGGER_TYPES,
} from "../rule-model";
import { THEME_IDS, isThemeId } from "../themes";
import { COMPONENT_FIELDS } from "./schema-catalog";

export type Severity = "error" | "warning";

export interface Diagnostic {
  code: string;
  severity: Severity;
  filePath: string;
  fieldPath: string;
  value?: string;
  message: string;
  suggestion: string;
}

type RecordValue = Record<string, unknown>;
type IdentifiedRecord = RecordValue & { id: string };

export interface CardResource {
  id: string;
  title: string;
  columnId: string | null;
  previousColumnId: string | null;
  position: number;
  completed: boolean;
  completedAt: string | null;
  dueAt: string | null;
  tagIds: string[];
  checklistIds: string[];
  commentIds: string[];
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  body: string;
  archived: boolean;
}

export interface OwnedResource {
  id: string;
  cardId: string;
  body?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface WorkspaceSnapshot {
  root: string;
  workspace: RecordValue;
  columns: Map<string, IdentifiedRecord>;
  tags: Map<string, IdentifiedRecord>;
  cards: Map<string, CardResource>;
  checklists: Map<string, OwnedResource & { items: RecordValue[] }>;
  comments: Map<string, OwnedResource & { body: string }>;
  rules: Map<string, IdentifiedRecord>;
  templates: Map<string, IdentifiedRecord>;
}

export interface ValidationResult {
  errors: Diagnostic[];
  warnings: Diagnostic[];
  workspace?: WorkspaceSnapshot;
}

const SCHEMA_VERSION = 1;
const ID_PATTERN =
  /^(workspace|card|column|tag|rule|comment|checklist|template)_[a-z0-9]+(?:_[a-z0-9]+)*$/;
const COLORS = new Set(["slate", "blue", "green", "amber", "rose", "violet", "teal", "neutral"]);
const REQUIRED_PATHS = [
  "cards",
  "columns",
  "tags",
  "rules",
  "comments",
  "checklists",
  "templates",
  "archive",
  "system",
] as const;

class Collector {
  readonly diagnostics: Diagnostic[] = [];

  add(
    code: string,
    filePath: string,
    fieldPath: string,
    message: string,
    suggestion: string,
    value?: unknown,
    severity: Severity = "error",
  ) {
    this.diagnostics.push({
      code,
      severity,
      filePath,
      fieldPath,
      ...(value === undefined ? {} : { value: String(value) }),
      message,
      suggestion,
    });
  }
}

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function relativePath(root: string, filePath: string) {
  return relative(root, filePath).replaceAll("\\", "/");
}

function readString(
  value: RecordValue,
  key: string,
  collector: Collector,
  filePath: string,
  required = true,
): string | undefined {
  const found = value[key];
  if (found === undefined || found === null) {
    if (required)
      collector.add(
        "E_REQUIRED_FIELD",
        filePath,
        key,
        `Required field "${key}" is missing.`,
        `Add a ${key} value.`,
      );
    return undefined;
  }
  if (typeof found !== "string" || found.trim() === "") {
    collector.add(
      "E_INVALID_FIELD_TYPE",
      filePath,
      key,
      `Field "${key}" must be a non-empty string.`,
      `Replace it with a string value.`,
      found,
    );
    return undefined;
  }
  return found;
}

function readNullableString(
  value: RecordValue,
  key: string,
  collector: Collector,
  filePath: string,
): string | null {
  const found = value[key];
  if (found === undefined || found === null) return null;
  if (typeof found !== "string") {
    collector.add(
      "E_INVALID_FIELD_TYPE",
      filePath,
      key,
      `Field "${key}" must be a string or null.`,
      "Use a string or null.",
      found,
    );
    return null;
  }
  return found;
}

function readBoolean(
  value: RecordValue,
  key: string,
  collector: Collector,
  filePath: string,
): boolean | undefined {
  const found = value[key];
  if (typeof found !== "boolean") {
    collector.add(
      "E_INVALID_FIELD_TYPE",
      filePath,
      key,
      `Field "${key}" must be a boolean.`,
      "Use true or false.",
      found,
    );
    return undefined;
  }
  return found;
}

function readPosition(
  value: RecordValue,
  key: string,
  collector: Collector,
  filePath: string,
): number | undefined {
  const found = value[key];
  if (typeof found !== "number" || !Number.isFinite(found) || found < 0) {
    collector.add(
      "E_INVALID_POSITION",
      filePath,
      key,
      `Field "${key}" must be a non-negative finite number.`,
      "Use a non-negative numeric position.",
      found,
    );
    return undefined;
  }
  return found;
}

function readIds(
  value: RecordValue,
  key: string,
  collector: Collector,
  filePath: string,
): string[] {
  const found = value[key];
  if (!Array.isArray(found) || found.some((item) => typeof item !== "string")) {
    collector.add(
      "E_INVALID_FIELD_TYPE",
      filePath,
      key,
      `Field "${key}" must be an array of IDs.`,
      "Use a YAML string list.",
      found,
    );
    return [];
  }
  const ids = found as string[];
  if (new Set(ids).size !== ids.length) {
    collector.add(
      "E_DUPLICATE_REFERENCE",
      filePath,
      key,
      `Field "${key}" contains duplicate references.`,
      "Keep each referenced ID once.",
    );
  }
  return ids;
}

function validateDate(
  value: string | null,
  collector: Collector,
  filePath: string,
  fieldPath: string,
) {
  if (value === null) return;
  if (!value.includes("T") || Number.isNaN(Date.parse(value))) {
    collector.add(
      "E_INVALID_DATETIME",
      filePath,
      fieldPath,
      `Field "${fieldPath}" must be an RFC 3339 datetime.`,
      "Use an ISO datetime with a timezone offset.",
      value,
    );
  }
}

function validateTimeZone(value: string | undefined, collector: Collector) {
  if (!value) return;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
  } catch {
    collector.add(
      "E_INVALID_TIMEZONE",
      "flowmark.yaml",
      "workspace.timezone",
      "Workspace timezone must be a valid IANA timezone.",
      "Use an IANA timezone such as Europe/Amsterdam or UTC.",
      value,
    );
  }
}

function validateId(
  id: string | undefined,
  kind: string,
  filePath: string,
  expectedFilename: string,
  collector: Collector,
) {
  if (!id) return;
  if (!ID_PATTERN.test(id) || !id.startsWith(`${kind}_`)) {
    collector.add(
      "E_INVALID_COMPONENT_ID",
      filePath,
      "id",
      `ID must be a lowercase ${kind}_ prefixed URL-safe ID.`,
      `Use an immutable ${kind}_ ID.`,
      id,
    );
  }
  if (
    kind !== "workspace" &&
    expectedFilename !== `${id}${expectedFilename.endsWith(".md") ? ".md" : ".yaml"}`
  ) {
    collector.add(
      "E_FILENAME_ID_MISMATCH",
      filePath,
      "id",
      "Component ID does not match its filename.",
      `Rename the file to ${id}${expectedFilename.endsWith(".md") ? ".md" : ".yaml"}.`,
      id,
    );
  }
}

function checkUnknownKeys(
  value: RecordValue,
  known: string[],
  collector: Collector,
  filePath: string,
  strict: boolean,
  fieldPrefix = "",
) {
  for (const key of Object.keys(value)) {
    if (!known.includes(key)) {
      collector.add(
        strict ? "E_UNKNOWN_FIELD" : "W_UNKNOWN_FIELD",
        filePath,
        fieldPrefix ? `${fieldPrefix}.${key}` : key,
        `Field "${key}" is not part of schema version ${SCHEMA_VERSION}.`,
        "Remove it or rerun validation without --strict if it is intentional.",
        value[key],
        strict ? "error" : "warning",
      );
    }
  }
}

function parseYaml(
  source: string,
  collector: Collector,
  filePath: string,
): RecordValue | undefined {
  const document = parseDocument(source, { prettyErrors: false });
  for (const error of document.errors)
    collector.add("E_INVALID_YAML", filePath, "", error.message, "Fix the YAML syntax.");
  if (document.errors.length > 0) return undefined;
  const value = document.toJSON();
  if (!isRecord(value)) {
    collector.add(
      "E_INVALID_YAML_ROOT",
      filePath,
      "",
      "YAML root must be a mapping.",
      "Use key/value fields at the document root.",
    );
    return undefined;
  }
  return value;
}

function parseMarkdown(
  source: string,
  collector: Collector,
  filePath: string,
): { frontmatter: RecordValue; body: string } | undefined {
  if (!source.startsWith("---\n") && !source.startsWith("---\r\n")) {
    collector.add(
      "E_MISSING_FRONTMATTER",
      filePath,
      "frontmatter",
      "Markdown component has no YAML frontmatter.",
      "Start the file with --- followed by YAML frontmatter.",
    );
    return undefined;
  }
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    collector.add(
      "E_INVALID_FRONTMATTER",
      filePath,
      "frontmatter",
      "Markdown frontmatter is not closed.",
      "Close it with a line containing ---.",
    );
    return undefined;
  }
  const frontmatter = parseYaml(match[1], collector, filePath);
  return frontmatter ? { frontmatter, body: source.slice(match[0].length) } : undefined;
}

async function listFiles(
  root: string,
  directory: string,
  extension: ".yaml" | ".md",
  collector: Collector,
): Promise<string[]> {
  const absolute = resolve(root, directory);
  try {
    if (!(await stat(absolute)).isDirectory()) throw new Error("not a directory");
  } catch {
    collector.add(
      "E_REQUIRED_DIRECTORY_MISSING",
      directory,
      "",
      `Required directory "${directory}" is missing.`,
      `Create ${directory}/.`,
    );
    return [];
  }
  const entries = await readdir(absolute, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => resolve(absolute, entry.name));
}

function register<T extends { id: string }>(
  map: Map<string, T>,
  item: T,
  collector: Collector,
  filePath: string,
) {
  if (map.has(item.id)) {
    collector.add(
      "E_DUPLICATE_COMPONENT_ID",
      filePath,
      "id",
      `Duplicate component ID "${item.id}".`,
      "Assign a unique immutable ID.",
      item.id,
    );
    return;
  }
  map.set(item.id, item);
}

function validateSchemaVersion(value: RecordValue, collector: Collector, filePath: string) {
  if (value.schema_version !== SCHEMA_VERSION) {
    collector.add(
      "E_UNSUPPORTED_SCHEMA_VERSION",
      filePath,
      "schema_version",
      `Only schema version ${SCHEMA_VERSION} is supported.`,
      "Upgrade Flowmark to a version that supports this schema.",
      value.schema_version,
    );
  }
}

function validateColor(color: string | null, collector: Collector, filePath: string) {
  if (color === null) return;
  if (
    COLORS.has(color) ||
    /^#[0-9a-fA-F]{6}$/.test(color) ||
    /^rgb\([^)]*\)$/.test(color) ||
    /^hsl\([^)]*\)$/.test(color)
  )
    return;
  collector.add(
    "E_INVALID_COLOR",
    filePath,
    "color",
    "Color must be a supported token or a valid custom CSS color.",
    "Use a supported token or #RRGGBB/rgb()/hsl().",
    color,
  );
}

function ref(
  map: Map<string, unknown>,
  id: string,
  kind: string,
  collector: Collector,
  filePath: string,
  fieldPath: string,
) {
  if (!map.has(id))
    collector.add(
      `E_REF_${kind.toUpperCase()}_NOT_FOUND`,
      filePath,
      fieldPath,
      `Referenced ${kind} does not exist.`,
      `Create ${kind}s/${id}.${kind === "column" || kind === "tag" ? "yaml" : "md"} or replace the ID.`,
      id,
    );
}

function validateRuleReferences(
  rule: RecordValue,
  columns: Map<string, RecordValue>,
  tags: Map<string, RecordValue>,
  collector: Collector,
  filePath: string,
  strict: boolean,
) {
  const trigger = rule.trigger;
  if (!isRecord(trigger) || typeof trigger.type !== "string") {
    collector.add(
      "E_INVALID_RULE_TRIGGER",
      filePath,
      "trigger",
      "Rule trigger must have a supported type.",
      "Provide a supported trigger object.",
    );
    return;
  }
  const triggers = new Set<string>(RULE_TRIGGER_TYPES);
  if (!triggers.has(trigger.type))
    collector.add(
      "E_INVALID_RULE_TRIGGER",
      filePath,
      "trigger.type",
      "Rule trigger type is unsupported.",
      "Use a supported trigger type.",
      trigger.type,
    );
  const triggerFields =
    trigger.type === "card_entered_column"
      ? ["type", "column_id"]
      : trigger.type === "schedule"
        ? ["type", "cron", "timezone"]
        : ["type"];
  checkUnknownKeys(trigger, triggerFields, collector, filePath, strict, "trigger");
  if (trigger.type === "card_entered_column") {
    if (typeof trigger.column_id !== "string")
      collector.add(
        "E_INVALID_RULE_TRIGGER",
        filePath,
        "trigger.column_id",
        "Card-entered-column trigger requires column_id.",
        "Set column_id to an existing column ID.",
        trigger.column_id,
      );
    else ref(columns, trigger.column_id, "column", collector, filePath, "trigger.column_id");
  }
  if (trigger.type === "schedule") {
    if (typeof trigger.cron !== "string")
      collector.add(
        "E_INVALID_CRON",
        filePath,
        "trigger.cron",
        "Scheduled rule requires a cron expression.",
        "Provide a five-field cron expression.",
      );
    else {
      try {
        new Cron(trigger.cron, {
          timezone: typeof trigger.timezone === "string" ? trigger.timezone : undefined,
        });
      } catch {
        collector.add(
          "E_INVALID_CRON",
          filePath,
          "trigger.cron",
          "Cron expression or timezone is invalid.",
          "Use a valid cron expression and IANA timezone.",
          trigger.cron,
        );
      }
    }
  }
  const conditionTypes = new Set<string>(RULE_CONDITION_TYPES);
  const conditions = rule.conditions === undefined ? [] : rule.conditions;
  if (!Array.isArray(conditions)) {
    collector.add(
      "E_INVALID_RULE_CONDITION",
      filePath,
      "conditions",
      "Rule conditions must be a list.",
      "Use a YAML list of supported condition objects.",
    );
  } else
    for (const [index, condition] of conditions.entries()) {
      if (
        !isRecord(condition) ||
        typeof condition.type !== "string" ||
        !conditionTypes.has(condition.type)
      ) {
        collector.add(
          "E_INVALID_RULE_CONDITION",
          filePath,
          `conditions[${index}]`,
          "Rule condition is unsupported.",
          "Use a supported condition type.",
        );
        continue;
      }
      const conditionFields =
        condition.type === "column"
          ? typeof condition.column_id === "string"
            ? ["type", "column_id"]
            : ["type", "operator", "column_ids"]
          : condition.type === "tag"
            ? ["type", "tag_id"]
            : condition.type === "completed" || condition.type === "due_state"
              ? ["type", "value"]
              : ["type", "operator", "value"];
      checkUnknownKeys(
        condition,
        conditionFields,
        collector,
        filePath,
        strict,
        `conditions[${index}]`,
      );
      if (condition.type === "column") {
        const singular = typeof condition.column_id === "string";
        const listed = typeof condition.operator === "string" || condition.column_ids !== undefined;
        if (singular === listed) {
          collector.add(
            "E_INVALID_RULE_CONDITION",
            filePath,
            `conditions[${index}]`,
            "Column condition must use either column_id or operator with column_ids.",
            "Use column_id for equality, or operator: in/not_in with a non-empty column_ids list.",
          );
        } else if (singular) {
          ref(
            columns,
            condition.column_id as string,
            "column",
            collector,
            filePath,
            `conditions[${index}].column_id`,
          );
        } else {
          if (
            typeof condition.operator !== "string" ||
            !(COLUMN_CONDITION_OPERATORS as readonly string[]).includes(condition.operator)
          )
            collector.add(
              "E_INVALID_RULE_CONDITION",
              filePath,
              `conditions[${index}].operator`,
              "Column condition operator must be in or not_in.",
              "Use operator: in or operator: not_in.",
              condition.operator,
            );
          if (
            !Array.isArray(condition.column_ids) ||
            condition.column_ids.length === 0 ||
            condition.column_ids.some((id) => typeof id !== "string") ||
            new Set(condition.column_ids).size !== condition.column_ids.length
          )
            collector.add(
              "E_INVALID_RULE_CONDITION",
              filePath,
              `conditions[${index}].column_ids`,
              "Column condition column_ids must be a non-empty list of unique IDs.",
              "List one or more unique column IDs.",
            );
          else
            for (const [columnIndex, columnId] of condition.column_ids.entries())
              ref(
                columns,
                columnId as string,
                "column",
                collector,
                filePath,
                `conditions[${index}].column_ids[${columnIndex}]`,
              );
        }
      }
      if (condition.type === "tag") {
        if (typeof condition.tag_id !== "string")
          collector.add(
            "E_INVALID_RULE_CONDITION",
            filePath,
            `conditions[${index}].tag_id`,
            "Tag condition requires tag_id.",
            "Set tag_id to an existing tag ID.",
            condition.tag_id,
          );
        else ref(tags, condition.tag_id, "tag", collector, filePath, `conditions[${index}].tag_id`);
      }
      if (condition.type === "completed" && typeof condition.value !== "boolean")
        collector.add(
          "E_INVALID_RULE_CONDITION",
          filePath,
          `conditions[${index}].value`,
          "Completed condition value must be boolean.",
          "Use true or false.",
          condition.value,
        );
      if (
        condition.type === "due_state" &&
        (typeof condition.value !== "string" ||
          !(DUE_STATES as readonly string[]).includes(condition.value))
      )
        collector.add(
          "E_INVALID_RULE_CONDITION",
          filePath,
          `conditions[${index}].value`,
          `Due state must be one of: ${DUE_STATES.join(", ")}.`,
          `Use one of: ${DUE_STATES.join(", ")}.`,
          condition.value,
        );
      if (
        (condition.type === "created_age_days" || condition.type === "completed_age_days") &&
        (typeof condition.value !== "number" ||
          !Number.isFinite(condition.value) ||
          condition.value < 0)
      )
        collector.add(
          "E_INVALID_RULE_CONDITION",
          filePath,
          `conditions[${index}].value`,
          "Age condition value must be a non-negative number of days.",
          "Use a non-negative numeric value.",
          condition.value,
        );
      if (
        (condition.type === "created_age_days" || condition.type === "completed_age_days") &&
        condition.operator !== undefined &&
        condition.operator !== "greater_than_or_equal"
      )
        collector.add(
          "E_INVALID_RULE_CONDITION",
          filePath,
          `conditions[${index}].operator`,
          "Age condition operator must be greater_than_or_equal.",
          "Use operator: greater_than_or_equal or omit it.",
          condition.operator,
        );
    }
  const actions = rule.actions;
  if (!Array.isArray(actions) || actions.length === 0) {
    collector.add(
      "E_INVALID_RULE_ACTIONS",
      filePath,
      "actions",
      "Rule must contain at least one action.",
      "Add a supported action.",
    );
    return;
  }
  const actionTypes = new Set<string>(RULE_ACTION_TYPES);
  for (const [index, action] of actions.entries()) {
    if (!isRecord(action) || typeof action.type !== "string" || !actionTypes.has(action.type)) {
      collector.add(
        "E_INVALID_RULE_ACTION",
        filePath,
        `actions[${index}]`,
        "Rule action is unsupported.",
        "Use a supported action type.",
      );
      continue;
    }
    const actionFields =
      action.type === "move_card"
        ? ["type", "column_id"]
        : action.type === "set_due_date"
          ? ["type", "mode", "offset_days"]
          : action.type === "add_tag" || action.type === "remove_tag"
            ? ["type", "tag_id"]
            : action.type === "sort_cards"
              ? ["type", "scope", "by", "direction", "nulls"]
              : ["type"];
    checkUnknownKeys(action, actionFields, collector, filePath, strict, `actions[${index}]`);
    if (action.type === "move_card") {
      if (typeof action.column_id !== "string")
        collector.add(
          "E_INVALID_RULE_ACTION",
          filePath,
          `actions[${index}].column_id`,
          "Move-card action requires column_id.",
          "Set column_id to an existing column ID.",
          action.column_id,
        );
      else
        ref(
          columns,
          action.column_id,
          "column",
          collector,
          filePath,
          `actions[${index}].column_id`,
        );
    }
    if (action.type === "add_tag" || action.type === "remove_tag") {
      if (typeof action.tag_id !== "string")
        collector.add(
          "E_INVALID_RULE_ACTION",
          filePath,
          `actions[${index}].tag_id`,
          `${action.type} action requires tag_id.`,
          "Set tag_id to an existing tag ID.",
          action.tag_id,
        );
      else ref(tags, action.tag_id, "tag", collector, filePath, `actions[${index}].tag_id`);
    }
    if (action.type === "set_due_date") {
      if (action.mode !== "end_of_day" && action.mode !== "offset")
        collector.add(
          "E_INVALID_RULE_ACTION",
          filePath,
          `actions[${index}].mode`,
          "Set-due-date mode must be end_of_day or offset.",
          "Use mode: end_of_day or mode: offset.",
          action.mode,
        );
      if (
        action.mode === "offset" &&
        (typeof action.offset_days !== "number" || !Number.isInteger(action.offset_days))
      )
        collector.add(
          "E_INVALID_RULE_ACTION",
          filePath,
          `actions[${index}].offset_days`,
          "Offset due-date action requires an integer offset_days.",
          "Set offset_days to an integer.",
          action.offset_days,
        );
      if (action.mode === "end_of_day" && action.offset_days !== undefined)
        collector.add(
          "E_INVALID_RULE_ACTION",
          filePath,
          `actions[${index}].offset_days`,
          "End-of-day due-date action does not accept offset_days.",
          "Remove offset_days or use mode: offset.",
          action.offset_days,
        );
    }
    if (
      trigger.type === "card_entered_column" &&
      action.type === "move_card" &&
      action.column_id === trigger.column_id
    )
      collector.add(
        "E_RULE_SELF_TRIGGER",
        filePath,
        `actions[${index}]`,
        "Rule moves a card into the same column that triggers it.",
        "Remove the action or change the trigger.",
      );
    if (
      action.type === "sort_cards" &&
      (action.scope !== "all_columns" ||
        action.by !== "due_at" ||
        action.direction !== "ascending" ||
        action.nulls !== "last")
    )
      collector.add(
        "E_INVALID_RULE_ACTION",
        filePath,
        `actions[${index}]`,
        "Sort-cards action must sort all columns by due_at ascending with nulls last.",
        "Use scope: all_columns, by: due_at, direction: ascending, and nulls: last.",
      );
  }
}

function validateObviousRuleCycles(rules: Map<string, IdentifiedRecord>, collector: Collector) {
  const edges: Array<{
    from: string;
    to: string;
    rule: IdentifiedRecord;
    actionIndex: number;
  }> = [];
  for (const rule of rules.values()) {
    const trigger = isRecord(rule.trigger) ? rule.trigger : undefined;
    const conditions = Array.isArray(rule.conditions) ? rule.conditions : [];
    if (
      trigger?.type !== "card_entered_column" ||
      typeof trigger.column_id !== "string" ||
      conditions.length > 0 ||
      !Array.isArray(rule.actions)
    )
      continue;
    for (const [actionIndex, candidate] of rule.actions.entries()) {
      if (
        isRecord(candidate) &&
        candidate.type === "move_card" &&
        typeof candidate.column_id === "string" &&
        candidate.column_id !== trigger.column_id
      )
        edges.push({
          from: trigger.column_id,
          to: candidate.column_id,
          rule,
          actionIndex,
        });
    }
  }

  const reachable = (start: string, target: string, excluded: number) => {
    const queue = [start];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const columnId = queue.shift()!;
      if (columnId === target) return true;
      if (visited.has(columnId)) continue;
      visited.add(columnId);
      for (const [index, edge] of edges.entries())
        if (index !== excluded && edge.from === columnId) queue.push(edge.to);
    }
    return false;
  };

  for (const [index, edge] of edges.entries()) {
    if (!reachable(edge.to, edge.from, index)) continue;
    collector.add(
      "E_RULE_CYCLE",
      String(edge.rule.__filePath ?? `rules/${edge.rule.id}.yaml`),
      `actions[${edge.actionIndex}]`,
      `Unconditional move rules form a cycle through ${edge.from} and ${edge.to}.`,
      "Add a condition that breaks the cycle or remove one of the move actions.",
      `${edge.from} -> ${edge.to}`,
    );
  }
}

export async function validateWorkspace(
  root: string,
  options: { strict?: boolean } = {},
): Promise<ValidationResult> {
  const collector = new Collector();
  const rootFile = resolve(root, "flowmark.yaml");
  let rootYaml: RecordValue | undefined;
  try {
    rootYaml = parseYaml(await readFile(rootFile, "utf8"), collector, "flowmark.yaml");
  } catch {
    collector.add(
      "E_WORKSPACE_FILE_NOT_FOUND",
      "flowmark.yaml",
      "",
      "Root flowmark.yaml file is missing.",
      "Run flowmark init to create this workspace.",
    );
  }
  if (!rootYaml) return finish(collector);
  validateSchemaVersion(rootYaml, collector, "flowmark.yaml");
  checkUnknownKeys(
    rootYaml,
    [...COMPONENT_FIELDS.workspace],
    collector,
    "flowmark.yaml",
    options.strict === true,
  );
  const workspace = isRecord(rootYaml.workspace) ? rootYaml.workspace : undefined;
  const paths = isRecord(rootYaml.paths) ? rootYaml.paths : undefined;
  if (!workspace)
    collector.add(
      "E_REQUIRED_FIELD",
      "flowmark.yaml",
      "workspace",
      "Workspace identity is missing.",
      "Add the workspace mapping.",
    );
  if (!paths)
    collector.add(
      "E_REQUIRED_FIELD",
      "flowmark.yaml",
      "paths",
      "Workspace paths are missing.",
      "Add the paths mapping.",
    );
  const pathValues = new Map<string, string>();
  if (paths) {
    checkUnknownKeys(
      paths,
      [...REQUIRED_PATHS],
      collector,
      "flowmark.yaml",
      options.strict === true,
      "paths",
    );
    for (const key of REQUIRED_PATHS) {
      const value = readString(paths, key, collector, "flowmark.yaml");
      if (!value) continue;
      const absolute = resolve(root, value);
      if (isAbsolute(value) || relative(root, absolute).startsWith(".."))
        collector.add(
          "E_INVALID_WORKSPACE_PATH",
          "flowmark.yaml",
          `paths.${key}`,
          "Workspace path must be relative and remain inside the workspace.",
          "Use a relative directory path.",
          value,
        );
      pathValues.set(key, value);
    }
  }
  if (workspace) {
    checkUnknownKeys(
      workspace,
      ["id", "name", "created_at", "timezone"],
      collector,
      "flowmark.yaml",
      options.strict === true,
      "workspace",
    );
    const id = readString(workspace, "id", collector, "flowmark.yaml");
    validateId(id, "workspace", "flowmark.yaml", "flowmark.yaml", collector);
    readString(workspace, "name", collector, "flowmark.yaml");
    validateDate(
      readString(workspace, "created_at", collector, "flowmark.yaml") ?? null,
      collector,
      "flowmark.yaml",
      "workspace.created_at",
    );
    validateTimeZone(readString(workspace, "timezone", collector, "flowmark.yaml"), collector);
  }
  const cardsDir = pathValues.get("cards") ?? "cards";
  const columnsDir = pathValues.get("columns") ?? "columns";
  const tagsDir = pathValues.get("tags") ?? "tags";
  const rulesDir = pathValues.get("rules") ?? "rules";
  const commentsDir = pathValues.get("comments") ?? "comments";
  const checklistsDir = pathValues.get("checklists") ?? "checklists";
  const templatesDir = pathValues.get("templates") ?? "templates";
  const archiveDir = pathValues.get("archive") ?? "archive";
  const yamlKinds = [
    ["column", columnsDir],
    ["tag", tagsDir],
    ["rule", rulesDir],
    ["checklist", checklistsDir],
    ["checklist", `${archiveDir}/checklists`],
    ["template", templatesDir],
  ] as const;
  const columns = new Map<string, IdentifiedRecord>();
  const tags = new Map<string, IdentifiedRecord>();
  const rules = new Map<string, IdentifiedRecord>();
  const templates = new Map<string, IdentifiedRecord>();
  const checklists = new Map<string, OwnedResource & { items: RecordValue[] }>();
  const cards = new Map<string, CardResource>();
  const comments = new Map<string, OwnedResource & { body: string }>();
  for (const [kind, directory] of yamlKinds)
    for (const absolute of await listFiles(root, directory, ".yaml", collector)) {
      const filePath = relativePath(root, absolute);
      const value = parseYaml(await readFile(absolute, "utf8"), collector, filePath);
      if (!value) continue;
      validateSchemaVersion(value, collector, filePath);
      const id = readString(value, "id", collector, filePath);
      validateId(id, kind, filePath, filePath.split("/").at(-1) ?? "", collector);
      validateDate(
        readString(value, "created_at", collector, filePath) ?? null,
        collector,
        filePath,
        "created_at",
      );
      validateDate(
        readString(value, "updated_at", collector, filePath) ?? null,
        collector,
        filePath,
        "updated_at",
      );
      if (!id) continue;
      if (kind === "column") {
        checkUnknownKeys(
          value,
          [...COMPONENT_FIELDS.column],
          collector,
          filePath,
          options.strict === true,
        );
        readString(value, "name", collector, filePath);
        readPosition(value, "position", collector, filePath);
        validateColor(readNullableString(value, "color", collector, filePath), collector, filePath);
        register(columns, { ...value, id, __filePath: filePath }, collector, filePath);
      }
      if (kind === "tag") {
        checkUnknownKeys(
          value,
          [...COMPONENT_FIELDS.tag],
          collector,
          filePath,
          options.strict === true,
        );
        readString(value, "name", collector, filePath);
        validateColor(readNullableString(value, "color", collector, filePath), collector, filePath);
        register(tags, { ...value, id, __filePath: filePath }, collector, filePath);
      }
      if (kind === "rule") {
        checkUnknownKeys(
          value,
          [...COMPONENT_FIELDS.rule],
          collector,
          filePath,
          options.strict === true,
        );
        register(rules, { ...value, id, __filePath: filePath }, collector, filePath);
      }
      if (kind === "template") {
        checkUnknownKeys(
          value,
          [...COMPONENT_FIELDS.template],
          collector,
          filePath,
          options.strict === true,
        );
        readString(value, "name", collector, filePath);
        if (value.card !== undefined && !isRecord(value.card))
          collector.add(
            "E_INVALID_FIELD_TYPE",
            filePath,
            "card",
            "Template card defaults must be a mapping.",
            "Use a YAML mapping for card defaults.",
          );
        if (
          value.checklist !== undefined &&
          (!Array.isArray(value.checklist) ||
            value.checklist.some((item) => typeof item !== "string"))
        )
          collector.add(
            "E_INVALID_FIELD_TYPE",
            filePath,
            "checklist",
            "Template checklist must be a list of strings.",
            "Use a YAML list of checklist item text.",
          );
        register(templates, { ...value, id, __filePath: filePath }, collector, filePath);
      }
      if (kind === "checklist") {
        checkUnknownKeys(
          value,
          [...COMPONENT_FIELDS.checklist],
          collector,
          filePath,
          options.strict === true,
        );
        const cardId = readString(value, "card_id", collector, filePath);
        readString(value, "title", collector, filePath);
        readPosition(value, "position", collector, filePath);
        const items = Array.isArray(value.items) ? value.items.filter(isRecord) : [];
        if (!Array.isArray(value.items))
          collector.add(
            "E_INVALID_FIELD_TYPE",
            filePath,
            "items",
            "Checklist items must be a list.",
            "Add a YAML list of items.",
          );
        const itemIds = new Set<string>();
        for (const [index, item] of items.entries()) {
          checkUnknownKeys(
            item,
            ["id", "text", "completed", "position"],
            collector,
            filePath,
            options.strict === true,
            `items[${index}]`,
          );
          const itemId = readString(item, "id", collector, filePath);
          if (itemId && itemIds.has(itemId))
            collector.add(
              "E_DUPLICATE_CHECKLIST_ITEM_ID",
              filePath,
              `items[${index}].id`,
              "Checklist item ID is duplicated.",
              "Use a unique item ID.",
              itemId,
            );
          if (itemId) itemIds.add(itemId);
          readString(item, "text", collector, filePath);
          readBoolean(item, "completed", collector, filePath);
          readPosition(item, "position", collector, filePath);
        }
        if (cardId) register(checklists, { id, cardId, items }, collector, filePath);
      }
    }
  const markdownKinds = [
    ["card", cardsDir, false],
    ["card", `${archiveDir}/cards`, true],
    ["comment", commentsDir, false],
    ["comment", `${archiveDir}/comments`, true],
  ] as const;
  for (const [kind, directory, archived] of markdownKinds)
    for (const absolute of await listFiles(root, directory, ".md", collector)) {
      const filePath = relativePath(root, absolute);
      const parsed = parseMarkdown(await readFile(absolute, "utf8"), collector, filePath);
      if (!parsed) continue;
      const value = parsed.frontmatter;
      validateSchemaVersion(value, collector, filePath);
      const id = readString(value, "id", collector, filePath);
      validateId(id, kind, filePath, filePath.split("/").at(-1) ?? "", collector);
      if (!id) continue;
      if (kind === "comment") {
        checkUnknownKeys(
          value,
          [...COMPONENT_FIELDS.comment],
          collector,
          filePath,
          options.strict === true,
        );
        const cardId = readString(value, "card_id", collector, filePath);
        readString(value, "author", collector, filePath);
        const createdAt = readString(value, "created_at", collector, filePath);
        const updatedAt = readString(value, "updated_at", collector, filePath);
        validateDate(createdAt ?? null, collector, filePath, "created_at");
        validateDate(updatedAt ?? null, collector, filePath, "updated_at");
        if (parsed.body.trim() === "")
          collector.add(
            "E_EMPTY_COMMENT_BODY",
            filePath,
            "body",
            "Comment body must not be empty.",
            "Add comment text.",
          );
        if (cardId) {
          register(
            comments,
            { id, cardId, body: parsed.body, createdAt, updatedAt },
            collector,
            filePath,
          );
        }
        continue;
      }
      checkUnknownKeys(
        value,
        [...COMPONENT_FIELDS.card],
        collector,
        filePath,
        options.strict === true,
      );
      const columnId = readNullableString(value, "column_id", collector, filePath);
      const previousColumnId = readNullableString(value, "previous_column_id", collector, filePath);
      const archivedAt = readNullableString(value, "archived_at", collector, filePath);
      const card: CardResource = {
        id,
        title: readString(value, "title", collector, filePath) ?? "",
        columnId,
        previousColumnId,
        position: readPosition(value, "position", collector, filePath) ?? 0,
        completed: readBoolean(value, "completed", collector, filePath) ?? false,
        completedAt: readNullableString(value, "completed_at", collector, filePath),
        dueAt: readNullableString(value, "due_at", collector, filePath),
        tagIds: readIds(value, "tag_ids", collector, filePath),
        checklistIds: readIds(value, "checklist_ids", collector, filePath),
        commentIds: readIds(value, "comment_ids", collector, filePath),
        createdAt: readString(value, "created_at", collector, filePath) ?? "",
        updatedAt: readString(value, "updated_at", collector, filePath) ?? "",
        archivedAt,
        body: parsed.body,
        archived,
      };
      validateDate(card.dueAt, collector, filePath, "due_at");
      validateDate(card.completedAt, collector, filePath, "completed_at");
      validateDate(card.createdAt || null, collector, filePath, "created_at");
      validateDate(card.updatedAt || null, collector, filePath, "updated_at");
      validateDate(card.archivedAt, collector, filePath, "archived_at");
      if (card.completed !== (card.completedAt !== null))
        collector.add(
          "E_INVALID_COMPLETION_STATE",
          filePath,
          "frontmatter.completed_at",
          "completed_at must be set exactly when the card is completed.",
          card.completed
            ? "Set completed_at to the completion datetime."
            : "Clear completed_at when completed is false.",
          card.completedAt,
        );
      if (
        archived &&
        (card.columnId !== null || card.previousColumnId === null || card.archivedAt === null)
      )
        collector.add(
          "E_INVALID_ARCHIVED_CARD_STATE",
          filePath,
          "frontmatter",
          "Archived card requires column_id: null, previous_column_id, and archived_at.",
          "Set the archive fields consistently.",
        );
      if (!archived && card.archivedAt !== null)
        collector.add(
          "E_INVALID_ACTIVE_CARD_STATE",
          filePath,
          "archived_at",
          "Active card must not set archived_at.",
          "Move it to archive/ or clear archived_at.",
        );
      register(cards, card, collector, filePath);
    }
  for (const [id, column] of columns) {
    const position = column.position;
    if (typeof position !== "number" || position < 0)
      collector.add(
        "E_INVALID_POSITION",
        String(column.__filePath ?? `columns/${id}.yaml`),
        "position",
        "Column position is invalid.",
        "Use a non-negative number.",
      );
  }
  for (const card of cards.values()) {
    const filePath = card.archived
      ? `${archiveDir}/cards/${card.id}.md`
      : `${cardsDir}/${card.id}.md`;
    if (card.archived) {
      if (card.previousColumnId)
        ref(
          columns,
          card.previousColumnId,
          "column",
          collector,
          filePath,
          "frontmatter.previous_column_id",
        );
    } else if (card.columnId)
      ref(columns, card.columnId, "column", collector, filePath, "frontmatter.column_id");
    else
      collector.add(
        "E_REF_COLUMN_NOT_FOUND",
        filePath,
        "frontmatter.column_id",
        "Active card must reference a column.",
        "Set column_id to an existing column ID.",
      );
    for (const tagId of card.tagIds)
      ref(tags, tagId, "tag", collector, filePath, "frontmatter.tag_ids");
    for (const checklistId of card.checklistIds) {
      const checklist = checklists.get(checklistId);
      if (!checklist)
        ref(checklists, checklistId, "checklist", collector, filePath, "frontmatter.checklist_ids");
      else if (checklist.cardId !== card.id)
        collector.add(
          "E_OWNERSHIP_MISMATCH",
          filePath,
          "frontmatter.checklist_ids",
          "Checklist points at another card.",
          "Make card and checklist references agree.",
          checklistId,
        );
    }
    for (const commentId of card.commentIds) {
      const comment = comments.get(commentId);
      if (!comment)
        ref(comments, commentId, "comment", collector, filePath, "frontmatter.comment_ids");
      else if (comment.cardId !== card.id)
        collector.add(
          "E_OWNERSHIP_MISMATCH",
          filePath,
          "frontmatter.comment_ids",
          "Comment points at another card.",
          "Make card and comment references agree.",
          commentId,
        );
    }
  }
  for (const checklist of checklists.values()) {
    const card = cards.get(checklist.cardId);
    if (!card)
      collector.add(
        "E_REF_CARD_NOT_FOUND",
        `${checklistsDir}/${checklist.id}.yaml`,
        "card_id",
        "Checklist owner card does not exist.",
        "Create the card or update card_id.",
        checklist.cardId,
      );
    else if (!card.checklistIds.includes(checklist.id))
      collector.add(
        "E_ORPHAN_CHECKLIST",
        `${checklistsDir}/${checklist.id}.yaml`,
        "card_id",
        "Card does not reference this checklist.",
        "Add it to card checklist_ids.",
        checklist.id,
      );
  }
  for (const comment of comments.values()) {
    const card = cards.get(comment.cardId);
    if (!card)
      collector.add(
        "E_REF_CARD_NOT_FOUND",
        `${commentsDir}/${comment.id}.md`,
        "card_id",
        "Comment owner card does not exist.",
        "Create the card or update card_id.",
        comment.cardId,
      );
    else if (!card.commentIds.includes(comment.id))
      collector.add(
        "E_ORPHAN_COMMENT",
        `${commentsDir}/${comment.id}.md`,
        "card_id",
        "Card does not reference this comment.",
        "Add it to card comment_ids.",
        comment.id,
      );
  }
  for (const rule of rules.values())
    validateRuleReferences(
      rule,
      columns,
      tags,
      collector,
      String(rule.__filePath ?? `rules/${rule.id}.yaml`),
      options.strict === true,
    );
  validateObviousRuleCycles(rules, collector);
  const defaults = isRecord(rootYaml.defaults) ? rootYaml.defaults : undefined;
  if (!defaults)
    collector.add(
      "E_REQUIRED_FIELD",
      "flowmark.yaml",
      "defaults",
      "Workspace defaults are missing.",
      "Add the defaults mapping.",
    );
  else {
    checkUnknownKeys(
      defaults,
      ["initial_column_id"],
      collector,
      "flowmark.yaml",
      options.strict === true,
      "defaults",
    );
    const id = readString(defaults, "initial_column_id", collector, "flowmark.yaml");
    if (id) ref(columns, id, "column", collector, "flowmark.yaml", "defaults.initial_column_id");
  }
  const ui = isRecord(rootYaml.ui) ? rootYaml.ui : undefined;
  if (ui) {
    checkUnknownKeys(
      ui,
      ["column_order", "theme"],
      collector,
      "flowmark.yaml",
      options.strict === true,
      "ui",
    );
    if (ui.theme !== undefined && !isThemeId(ui.theme))
      collector.add(
        "E_INVALID_THEME",
        "flowmark.yaml",
        "ui.theme",
        `Theme must be one of: ${THEME_IDS.join(", ")}.`,
        `Replace it with one of: ${THEME_IDS.join(", ")}.`,
        ui.theme,
      );
  }
  const order = ui?.column_order;
  if (!Array.isArray(order) || order.some((id) => typeof id !== "string"))
    collector.add(
      "E_INVALID_COLUMN_ORDER",
      "flowmark.yaml",
      "ui.column_order",
      "Column order must be an array of column IDs.",
      "List every active column exactly once.",
    );
  else {
    const ids = order as string[];
    if (
      new Set(ids).size !== ids.length ||
      ids.length !== columns.size ||
      ids.some((id) => !columns.has(id))
    )
      collector.add(
        "E_INVALID_COLUMN_ORDER",
        "flowmark.yaml",
        "ui.column_order",
        "Column order must reference every active column exactly once.",
        "Update the list to match active columns.",
      );
  }
  const snapshot: WorkspaceSnapshot = {
    root,
    workspace: rootYaml,
    columns,
    tags,
    cards,
    checklists,
    comments,
    rules,
    templates,
  };
  return finish(collector, snapshot);
}

function finish(collector: Collector, workspace?: WorkspaceSnapshot): ValidationResult {
  const errors = collector.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const warnings = collector.diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
  return errors.length === 0 ? { errors, warnings, workspace } : { errors, warnings };
}
