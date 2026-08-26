import type { DueState, RuleAction, RuleCondition, RuleTrigger } from "./rule-model";

const TRIGGER_OPTIONS: [RuleTrigger["kind"], string][] = [
  ["card.created", "A card is created"],
  ["schedule", "On a cron schedule"],
  ["scheduleEvery", "Every so many days"],
  ["card.moved", "A card is moved"],
  ["card.dueOn", "A card's due date is"],
  ["card.dueStateChanged", "A card's due-date state is evaluated"],
  ["card.completed", "A card completion changes"],
];

const CONDITION_OPTIONS: [RuleCondition["kind"], string][] = [
  ["column", "Column"],
  ["tag", "Tag"],
  ["completed", "Completion"],
  ["dueState", "Due state"],
  ["createdAgeDays", "Created age"],
  ["completedAgeDays", "Completed age"],
];

const DUE_STATE_OPTIONS: [DueState, string][] = [
  ["none", "no due date"],
  ["overdue", "overdue"],
  ["today", "today"],
  ["tomorrow", "tomorrow"],
  ["future", "later than tomorrow"],
];

const ACTION_OPTIONS: [RuleAction["kind"], string][] = [
  ["setDueDate", "Set due date"],
  ["clearDueDate", "Clear due date"],
  ["addTag", "Add tag"],
  ["removeTag", "Remove tag"],
  ["moveToColumn", "Move to column"],
  ["setCompleted", "Set completion"],
  ["sortByDueDate", "Sort every column by due date"],
  ["archiveCard", "Archive card"],
  ["createCard", "Create a card from a template"],
];

export function ruleTriggerOptions() {
  return TRIGGER_OPTIONS;
}

export function ruleConditionOptions(hasTags: boolean) {
  return CONDITION_OPTIONS.filter(([kind]) => hasTags || kind !== "tag");
}

export function ruleDueStateOptions() {
  return DUE_STATE_OPTIONS;
}

/**
 * Card creation only makes sense once a template exists and the rule runs on a
 * schedule, so it is offered only then.
 */
export function ruleActionOptions(hasTags: boolean, options: RuleActionScope = {}) {
  return ACTION_OPTIONS.filter(([kind]) => {
    if (!hasTags && (kind === "addTag" || kind === "removeTag")) return false;
    if (kind === "createCard") return options.hasTemplates === true && options.onSchedule === true;
    return true;
  });
}

export interface RuleActionScope {
  hasTemplates?: boolean;
  onSchedule?: boolean;
}

export async function prepareRulesModalOpen({
  hasPersistenceError,
  reloadFromDisk,
}: {
  hasPersistenceError: () => boolean;
  reloadFromDisk: () => Promise<void>;
}) {
  if (hasPersistenceError()) await reloadFromDisk();
}

export async function closeRulesModal({
  flushPendingSave,
  onClose,
}: {
  flushPendingSave: () => Promise<void>;
  onClose: () => void;
}) {
  await flushPendingSave();
  onClose();
  return true;
}
