import { stringify } from "yaml";

import {
  COLUMN_CONDITION_OPERATORS,
  DUE_STATES,
  RULE_ACTION_TYPES,
  RULE_TRIGGER_TYPES,
} from "../rule-model";
import { THEME_IDS } from "../themes";

export const COMPONENT_NAMES = [
  "workspace",
  "card",
  "column",
  "tag",
  "rule",
  "comment",
  "checklist",
  "template",
] as const;

export type ComponentName = (typeof COMPONENT_NAMES)[number];
export type SchemaFormat = "yaml" | "json";

export const COMPONENT_FIELDS: Record<ComponentName, readonly string[]> = {
  workspace: ["schema_version", "workspace", "paths", "defaults", "ui"],
  card: [
    "schema_version",
    "id",
    "title",
    "column_id",
    "previous_column_id",
    "position",
    "completed",
    "completed_at",
    "due_at",
    "tag_ids",
    "checklist_ids",
    "comment_ids",
    "created_at",
    "updated_at",
    "archived_at",
  ],
  column: ["schema_version", "id", "name", "position", "color", "created_at", "updated_at"],
  tag: ["schema_version", "id", "name", "color", "description", "created_at", "updated_at"],
  rule: [
    "schema_version",
    "id",
    "name",
    "enabled",
    "trigger",
    "conditions",
    "actions",
    "created_at",
    "updated_at",
  ],
  comment: ["schema_version", "id", "card_id", "author", "created_at", "updated_at"],
  checklist: [
    "schema_version",
    "id",
    "card_id",
    "title",
    "position",
    "created_at",
    "updated_at",
    "items",
  ],
  template: ["schema_version", "id", "name", "card", "checklist", "created_at", "updated_at"],
};

interface ComponentSchema {
  $schema: string;
  $id: string;
  title: string;
  description: string;
  type: "object";
  additionalProperties: false;
  properties: Record<string, unknown>;
  required: string[];
  $defs?: Record<string, unknown>;
  "x-flowmark-file": {
    format: "yaml" | "markdown-with-yaml-frontmatter";
    filename_pattern: string;
    authoritative: true;
  };
  "x-flowmark-markdown-body"?: { required: boolean; min_length?: number };
}

const DRAFT = "https://json-schema.org/draft/2020-12/schema";
const DATE_TIME = { type: "string", format: "date-time" } as const;
const NULLABLE_DATE_TIME = { oneOf: [DATE_TIME, { type: "null" }] } as const;
const NON_NEGATIVE_NUMBER = { type: "number", minimum: 0 } as const;
const ID = { type: "string", pattern: "^[a-z]+_[a-z0-9]+(?:_[a-z0-9]+)*$" } as const;
const STRING_ARRAY = { type: "array", items: { type: "string" }, uniqueItems: true } as const;
const COLOR = {
  oneOf: [
    { enum: ["slate", "blue", "green", "amber", "rose", "violet", "teal", "neutral"] },
    { type: "string", pattern: "^(#[0-9a-fA-F]{6}|rgb\\([^)]*\\)|hsl\\([^)]*\\))$" },
    { type: "null" },
  ],
} as const;

function schema(
  component: ComponentName,
  title: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  options: {
    format?: "yaml" | "markdown-with-yaml-frontmatter";
    body?: { required: boolean; min_length?: number };
    defs?: Record<string, unknown>;
  } = {},
): ComponentSchema {
  const extension = options.format === "markdown-with-yaml-frontmatter" ? "md" : "yaml";
  const prefix = component === "workspace" ? "flowmark" : component;
  return {
    $schema: DRAFT,
    $id: `https://flowmark.local/schema/v1/${component}.schema.json`,
    title,
    description,
    type: "object",
    additionalProperties: false,
    properties: { schema_version: { const: 1 }, ...properties },
    required: ["schema_version", ...required],
    ...(options.defs ? { $defs: options.defs } : {}),
    "x-flowmark-file": {
      format: options.format ?? "yaml",
      filename_pattern:
        component === "workspace"
          ? "^flowmark\\.yaml$"
          : `^${prefix}_[a-z0-9]+(?:_[a-z0-9]+)*\\.${extension}$`,
      authoritative: true,
    },
    ...(options.body ? { "x-flowmark-markdown-body": options.body } : {}),
  };
}

const workspaceSchema = schema(
  "workspace",
  "Flowmark workspace",
  "Workspace identity, source paths, structural defaults, and UI preferences.",
  {
    workspace: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string", pattern: "^workspace_[a-z0-9]+(?:_[a-z0-9]+)*$" },
        name: { type: "string", minLength: 1 },
        created_at: DATE_TIME,
        timezone: { type: "string", minLength: 1, description: "IANA timezone name." },
      },
      required: ["id", "name", "created_at", "timezone"],
    },
    paths: {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(
        [
          "cards",
          "columns",
          "tags",
          "rules",
          "comments",
          "checklists",
          "templates",
          "archive",
          "system",
        ].map((name) => [name, { type: "string", minLength: 1 }]),
      ),
      required: [
        "cards",
        "columns",
        "tags",
        "rules",
        "comments",
        "checklists",
        "templates",
        "archive",
        "system",
      ],
    },
    defaults: {
      type: "object",
      additionalProperties: false,
      properties: {
        initial_column_id: { type: "string", pattern: "^column_[a-z0-9]+(?:_[a-z0-9]+)*$" },
      },
      required: ["initial_column_id"],
    },
    ui: {
      type: "object",
      additionalProperties: false,
      properties: {
        column_order: {
          type: "array",
          items: { type: "string", pattern: "^column_[a-z0-9]+(?:_[a-z0-9]+)*$" },
          uniqueItems: true,
        },
        theme: { enum: [...THEME_IDS] },
      },
      required: ["column_order"],
    },
  },
  ["workspace", "paths", "defaults", "ui"],
);

const cardSchema = schema(
  "card",
  "Flowmark card frontmatter",
  "YAML frontmatter for an active or archived Markdown card.",
  {
    id: { type: "string", pattern: "^card_[a-z0-9]+(?:_[a-z0-9]+)*$" },
    title: { type: "string", minLength: 1 },
    column_id: { oneOf: [{ type: "string", pattern: "^column_" }, { type: "null" }] },
    previous_column_id: { oneOf: [{ type: "string", pattern: "^column_" }, { type: "null" }] },
    position: NON_NEGATIVE_NUMBER,
    completed: { type: "boolean" },
    completed_at: NULLABLE_DATE_TIME,
    due_at: NULLABLE_DATE_TIME,
    tag_ids: STRING_ARRAY,
    checklist_ids: STRING_ARRAY,
    comment_ids: STRING_ARRAY,
    created_at: DATE_TIME,
    updated_at: DATE_TIME,
    archived_at: NULLABLE_DATE_TIME,
  },
  [
    "id",
    "title",
    "column_id",
    "position",
    "completed",
    "completed_at",
    "due_at",
    "tag_ids",
    "checklist_ids",
    "comment_ids",
    "created_at",
    "updated_at",
    "archived_at",
  ],
  { format: "markdown-with-yaml-frontmatter", body: { required: false } },
);

const columnSchema = schema(
  "column",
  "Flowmark column",
  "A structural board column. Automation behavior belongs in rules.",
  {
    id: { type: "string", pattern: "^column_[a-z0-9]+(?:_[a-z0-9]+)*$" },
    name: { type: "string", minLength: 1 },
    position: NON_NEGATIVE_NUMBER,
    color: COLOR,
    created_at: DATE_TIME,
    updated_at: DATE_TIME,
  },
  ["id", "name", "position", "color", "created_at", "updated_at"],
);

const tagSchema = schema(
  "tag",
  "Flowmark tag",
  "A reusable card label.",
  {
    id: { type: "string", pattern: "^tag_[a-z0-9]+(?:_[a-z0-9]+)*$" },
    name: { type: "string", minLength: 1 },
    color: COLOR,
    description: { oneOf: [{ type: "string" }, { type: "null" }] },
    created_at: DATE_TIME,
    updated_at: DATE_TIME,
  },
  ["id", "name", "color", "created_at", "updated_at"],
);

const triggerSchema = {
  oneOf: [
    ...RULE_TRIGGER_TYPES.filter(
      (type) => type !== "card_entered_column" && type !== "schedule",
    ).map((type) => ({
      type: "object",
      additionalProperties: false,
      properties: { type: { const: type } },
      required: ["type"],
    })),
    {
      type: "object",
      additionalProperties: false,
      properties: { type: { const: "card_entered_column" }, column_id: { type: "string" } },
      required: ["type", "column_id"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        type: { const: "schedule" },
        cron: { type: "string" },
        timezone: { type: "string" },
      },
      required: ["type", "cron"],
    },
  ],
} as const;

const conditionSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        type: { const: "column" },
        column_id: { type: "string" },
      },
      required: ["type", "column_id"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        type: { const: "column" },
        operator: { enum: [...COLUMN_CONDITION_OPERATORS] },
        column_ids: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string" } },
      },
      required: ["type", "operator", "column_ids"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: { type: { const: "tag" }, tag_id: { type: "string" } },
      required: ["type", "tag_id"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: { type: { const: "completed" }, value: { type: "boolean" } },
      required: ["type", "value"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        type: { const: "due_state" },
        value: { enum: [...DUE_STATES] },
      },
      required: ["type", "value"],
    },
    ...["created_age_days", "completed_age_days"].map((type) => ({
      type: "object",
      additionalProperties: false,
      properties: {
        type: { const: type },
        operator: { enum: ["greater_than_or_equal"] },
        value: NON_NEGATIVE_NUMBER,
      },
      required: ["type", "value"],
    })),
  ],
} as const;

const actionSchema = {
  oneOf: [
    ...RULE_ACTION_TYPES.filter((type) =>
      ["clear_due_date", "mark_completed", "mark_uncompleted", "archive_card"].includes(type),
    ).map((type) => ({
      type: "object",
      additionalProperties: false,
      properties: { type: { const: type } },
      required: ["type"],
    })),
    {
      type: "object",
      additionalProperties: false,
      properties: { type: { const: "move_card" }, column_id: { type: "string" } },
      required: ["type", "column_id"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        type: { const: "set_due_date" },
        mode: { enum: ["end_of_day", "offset"] },
        offset_days: { type: "integer" },
      },
      required: ["type", "mode"],
    },
    ...["add_tag", "remove_tag"].map((type) => ({
      type: "object",
      additionalProperties: false,
      properties: { type: { const: type }, tag_id: { type: "string" } },
      required: ["type", "tag_id"],
    })),
    {
      type: "object",
      additionalProperties: false,
      properties: {
        type: { const: "sort_cards" },
        scope: { const: "all_columns" },
        by: { const: "due_at" },
        direction: { const: "ascending" },
        nulls: { const: "last" },
      },
      required: ["type", "scope", "by", "direction", "nulls"],
    },
  ],
} as const;

const ruleSchema = schema(
  "rule",
  "Flowmark automation rule",
  "A deterministic trigger, optional conditions, and ordered actions.",
  {
    id: { type: "string", pattern: "^rule_[a-z0-9]+(?:_[a-z0-9]+)*$" },
    name: { type: "string", minLength: 1 },
    enabled: { type: "boolean" },
    trigger: triggerSchema,
    conditions: { type: "array", items: conditionSchema },
    actions: { type: "array", minItems: 1, items: actionSchema },
    created_at: DATE_TIME,
    updated_at: DATE_TIME,
  },
  ["id", "name", "enabled", "trigger", "actions", "created_at", "updated_at"],
);

const commentSchema = schema(
  "comment",
  "Flowmark comment frontmatter",
  "YAML frontmatter for a Markdown card comment.",
  {
    id: { type: "string", pattern: "^comment_[a-z0-9]+(?:_[a-z0-9]+)*$" },
    card_id: { type: "string", pattern: "^card_" },
    author: { type: "string", minLength: 1 },
    created_at: DATE_TIME,
    updated_at: DATE_TIME,
  },
  ["id", "card_id", "author", "created_at", "updated_at"],
  {
    format: "markdown-with-yaml-frontmatter",
    body: { required: true, min_length: 1 },
  },
);

const checklistSchema = schema(
  "checklist",
  "Flowmark checklist",
  "A card-owned ordered checklist.",
  {
    id: { type: "string", pattern: "^checklist_[a-z0-9]+(?:_[a-z0-9]+)*$" },
    card_id: { type: "string", pattern: "^card_" },
    title: { type: "string", minLength: 1 },
    position: NON_NEGATIVE_NUMBER,
    created_at: DATE_TIME,
    updated_at: DATE_TIME,
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: ID,
          text: { type: "string", minLength: 1 },
          completed: { type: "boolean" },
          position: NON_NEGATIVE_NUMBER,
        },
        required: ["id", "text", "completed", "position"],
      },
    },
  },
  ["id", "card_id", "title", "position", "created_at", "updated_at", "items"],
);

const templateSchema = schema(
  "template",
  "Flowmark card template",
  "Reusable defaults for creating cards and checklist items.",
  {
    id: { type: "string", pattern: "^template_[a-z0-9]+(?:_[a-z0-9]+)*$" },
    name: { type: "string", minLength: 1 },
    card: { type: "object" },
    checklist: { type: "array", items: { type: "string" } },
    created_at: DATE_TIME,
    updated_at: DATE_TIME,
  },
  ["id", "name", "created_at", "updated_at"],
);

const CATALOG: Record<ComponentName, ComponentSchema> = {
  workspace: workspaceSchema,
  card: cardSchema,
  column: columnSchema,
  tag: tagSchema,
  rule: ruleSchema,
  comment: commentSchema,
  checklist: checklistSchema,
  template: templateSchema,
};

export function isComponentName(value: string): value is ComponentName {
  return (COMPONENT_NAMES as readonly string[]).includes(value);
}

export function getComponentSchema(component: string): ComponentSchema {
  if (!isComponentName(component)) throw new Error(`Unknown component schema: ${component}`);
  return structuredClone(CATALOG[component]);
}

export function formatComponentSchemas(
  components: readonly ComponentName[],
  format: SchemaFormat = "yaml",
): string {
  const value =
    components.length === 1
      ? { component: components[0], schema: getComponentSchema(components[0]) }
      : {
          schemas: Object.fromEntries(
            components.map((component) => [component, getComponentSchema(component)]),
          ),
        };
  return format === "json"
    ? `${JSON.stringify(value, null, 2)}\n`
    : stringify(value, { lineWidth: 0, sortMapEntries: false });
}
