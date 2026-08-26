import {
  describeTemplateVariables,
  renderTemplateText,
  validateTemplateText,
  type ExpressionContext,
  type VariableDescription,
} from "./template-expression";
import type { CardTemplate, TemplateDue } from "./workspace/templates-repository";

export type TemplateDueMode = TemplateDue["mode"];

export const TEMPLATE_ID_PATTERN = /^template_[a-z0-9]+(?:_[a-z0-9]+)*$/;

export function createTemplateId() {
  const suffix = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  return `template_${suffix}`;
}

const DUE_MODE_OPTIONS: [TemplateDueMode, string][] = [
  ["none", "No due date"],
  ["offset", "Relative to creation"],
  ["fixed", "A fixed date"],
];

export function templateDueModeOptions() {
  return DUE_MODE_OPTIONS;
}

export function templateDueLabel(due: TemplateDue): string {
  if (due.mode === "none") return "No due date";
  if (due.mode === "fixed") return `Due ${due.date}`;
  if (due.offsetDays === 0) return "Due the day it is created";
  if (due.offsetDays === 1) return "Due the day after it is created";
  if (due.offsetDays > 0) return `Due ${due.offsetDays} days after it is created`;
  return `Due ${Math.abs(due.offsetDays)} days before it is created`;
}

/**
 * Switching mode keeps whatever the other modes had, so flipping through the
 * options and back does not silently discard the number the user typed.
 */
export function withDueMode(due: TemplateDue, mode: TemplateDueMode, today: string): TemplateDue {
  if (mode === due.mode) return due;
  if (mode === "none") return { mode: "none" };
  if (mode === "offset")
    return { mode: "offset", offsetDays: due.mode === "offset" ? due.offsetDays : 0 };
  return { mode: "fixed", date: due.mode === "fixed" ? due.date : today };
}

/** Human-readable reasons a template cannot be saved; empty means it can. */
export function templateIssues(template: CardTemplate): string[] {
  const issues: string[] = [];
  if (!template.name.trim()) issues.push("Give the template a name.");
  if (!template.title.trim()) issues.push("Give the card a title.");
  for (const [label, text] of [
    ["Title", template.title],
    ["Description", template.body],
    ...template.checklist.map((item, index) => [`Checklist item ${index + 1}`, item] as const),
  ] as const)
    for (const issue of validateTemplateText(text))
      issues.push(`${label}: ${issue.expression} is not a usable expression. ${issue.message}`);
  if (template.due.mode === "fixed" && !/^\d{4}-\d{2}-\d{2}$/.test(template.due.date))
    issues.push("Pick a date for the fixed due date.");
  return issues;
}

export function templateVariableRows(context: ExpressionContext): VariableDescription[] {
  return describeTemplateVariables(context);
}

/** What the card would look like if the rule fired at `context.occurrence`. */
export function templatePreview(template: CardTemplate, context: ExpressionContext) {
  const dueDate =
    template.due.mode === "fixed"
      ? template.due.date
      : template.due.mode === "offset"
        ? context.dueDate
        : null;
  const resolved: ExpressionContext = { ...context, dueDate };
  return {
    title: renderTemplateText(template.title, resolved),
    body: renderTemplateText(template.body, resolved),
    checklist: template.checklist.map((item) => renderTemplateText(item, resolved)),
  };
}

export function emptyTemplate(id: string, columnId: string | null): CardTemplate {
  return {
    id,
    name: "New template",
    title: "",
    body: "",
    columnId,
    tagIds: [],
    due: { mode: "none" },
    checklist: [],
  };
}
