export const RULE_TRIGGER_TYPES = [
  "card_created",
  "card_entered_column",
  "card_completed",
  "card_uncompleted",
  "due_date_reached",
  "due_state_changed",
  "schedule",
] as const;

export const RULE_CONDITION_TYPES = [
  "column",
  "tag",
  "completed",
  "due_state",
  "created_age_days",
  "completed_age_days",
] as const;

export const RULE_ACTION_TYPES = [
  "move_card",
  "set_due_date",
  "clear_due_date",
  "add_tag",
  "remove_tag",
  "mark_completed",
  "mark_uncompleted",
  "archive_card",
  "sort_cards",
] as const;

export const DUE_STATES = ["none", "overdue", "today", "tomorrow", "future"] as const;
export const COLUMN_CONDITION_OPERATORS = ["in", "not_in"] as const;

export type DueState = (typeof DUE_STATES)[number];
export type DueWhen = Exclude<DueState, "none" | "future">;
export type ColumnConditionOperator = (typeof COLUMN_CONDITION_OPERATORS)[number];

export type RuleTrigger =
  | { kind: "card.created"; columnId: string | "*" }
  | { kind: "card.moved"; toColumnId: string }
  | { kind: "card.completed"; value: boolean }
  | { kind: "card.dueOn"; when: DueWhen }
  | { kind: "card.dueStateChanged" };

export type RuleCondition =
  | { kind: "column"; operator: ColumnConditionOperator; columnIds: string[] }
  | { kind: "tag"; tagId: string }
  | { kind: "completed"; value: boolean }
  | { kind: "dueState"; value: DueState }
  | { kind: "createdAgeDays"; value: number }
  | { kind: "completedAgeDays"; value: number };

export type RuleAction =
  | { kind: "setDueDate"; offsetDays: number }
  | { kind: "clearDueDate" }
  | { kind: "addTag"; tagId: string }
  | { kind: "removeTag"; tagId: string }
  | { kind: "moveToColumn"; columnId: string }
  | { kind: "setCompleted"; value: boolean }
  | { kind: "sortByDueDate" }
  | { kind: "archiveCard" };

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  trigger: RuleTrigger;
  conditions?: RuleCondition[];
  actions: RuleAction[];
}

export const RULE_ID_PATTERN = /^rule_[a-z0-9]+(?:_[a-z0-9]+)*$/;

export function createRuleId() {
  const suffix = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  return `rule_${suffix}`;
}
