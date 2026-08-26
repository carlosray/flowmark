/**
 * Renders a template into the concrete card a scheduled rule should create.
 *
 * Pure: it produces a description of the card, and leaves writing it to the
 * caller.
 */
import { calendarDateAtOffset } from "../calendar-date";
import { renderTemplateText, type ExpressionContext } from "../template-expression";
import type { CardTemplate, TemplateDue } from "./templates-repository";

export interface InstantiationRequest {
  template: CardTemplate;
  ruleId: string;
  occurrence: Date;
  timeZone: string;
  locale: string;
  /** Set by the rule action; overrides whatever the template names. */
  columnIdOverride?: string | null;
  /** `defaults.initial_column_id`, used when neither names a column. */
  defaultColumnId: string;
}

export interface CardOrigin {
  rule_id: string;
  template_id: string;
  occurrence: string;
}

export interface InstantiatedCard {
  cardId: string;
  title: string;
  body: string;
  columnId: string;
  tagIds: string[];
  dueDate: string | null;
  checklist: string[];
  origin: CardOrigin;
}

function createCardId() {
  const suffix = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  return `card_${suffix}`;
}

function resolveDue(due: TemplateDue, occurrence: Date, timeZone: string): string | null {
  if (due.mode === "offset") return calendarDateAtOffset(occurrence, due.offsetDays, timeZone);
  if (due.mode === "fixed") return due.date;
  return null;
}

export function instantiateTemplate(request: InstantiationRequest): InstantiatedCard {
  const { template, occurrence, timeZone, locale } = request;
  // The due date is resolved first so {{due_date}} can be used in the title.
  const dueDate = resolveDue(template.due, occurrence, timeZone);
  const context: ExpressionContext = { occurrence, dueDate, timeZone, locale };
  const render = (text: string) => renderTemplateText(text, context);
  return {
    cardId: createCardId(),
    title: render(template.title),
    body: render(template.body),
    columnId: request.columnIdOverride ?? template.columnId ?? request.defaultColumnId,
    tagIds: [...template.tagIds],
    dueDate,
    checklist: template.checklist.map(render),
    origin: {
      rule_id: request.ruleId,
      template_id: template.id,
      occurrence: occurrence.toISOString(),
    },
  };
}
