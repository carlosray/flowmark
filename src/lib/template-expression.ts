/**
 * Renders `{{...}}` expressions in card templates.
 *
 * Every variable is a projection of one underlying date. Arithmetic shifts that
 * date and the variable then reports its own aspect of the result, so there are
 * no variable/operator combinations to forbid.
 *
 * Pure: no filesystem, no workspace types. The template editor and the rule
 * runner share it.
 */

export interface ExpressionContext {
  /** The instant the schedule fired. */
  occurrence: Date;
  /** The already-resolved due date as a calendar date, or null when unset. */
  dueDate: string | null;
  /** Timezone the occurrence is interpreted in. */
  timeZone: string;
  /** BCP 47 locale used by the worded formats. */
  locale: string;
}

export interface ExpressionIssue {
  expression: string;
  message: string;
}

export interface VariableDescription {
  expression: string;
  description: string;
  preview: string;
}

interface CivilDate {
  year: number;
  month: number;
  day: number;
}

type FormatName = "iso" | "short" | "long" | "full" | "weekday" | "day" | "month" | "year";

const FORMAT_OPTIONS: Record<Exclude<FormatName, "iso">, Intl.DateTimeFormatOptions> = {
  short: { year: "numeric", month: "numeric", day: "numeric" },
  long: { month: "long", day: "numeric" },
  full: { year: "numeric", month: "long", day: "numeric" },
  weekday: { weekday: "long" },
  day: { day: "numeric" },
  month: { month: "long" },
  year: { year: "numeric" },
};

const FORMAT_NAMES = ["iso", ...Object.keys(FORMAT_OPTIONS)] as FormatName[];

const VARIABLES = ["date", "due_date", "weekday", "week"] as const;

export type TemplateVariable = (typeof VARIABLES)[number];

export const TEMPLATE_VARIABLES: readonly TemplateVariable[] = VARIABLES;

/** Variables that render something other than a date, so a format is meaningless. */
const FORMATLESS_VARIABLES: ReadonlySet<string> = new Set(["weekday", "week"]);

const VARIABLE_DESCRIPTIONS: Record<TemplateVariable, string> = {
  date: "Date the rule fires",
  due_date: "Due date given to the card",
  weekday: "Day of the week",
  week: "ISO week number",
};

const EXPRESSION = /\{\{([^{}]*)\}\}/g;
const PARTS = /^([a-z_]+)(?:([+-])(\d+)([dwm]))?(?::([a-z]+))?$/;

interface ParsedExpression {
  variable: TemplateVariable;
  amount: number;
  unit: "d" | "w" | "m";
  format: FormatName | null;
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function civilFromInstant(instant: Date, timeZone: string): CivilDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

function civilFromCalendarDate(value: string): CivilDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function civilToUtcDate(civil: CivilDate): Date {
  return new Date(Date.UTC(civil.year, civil.month - 1, civil.day));
}

function civilToCalendarDate(civil: CivilDate): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${civil.year}-${pad(civil.month)}-${pad(civil.day)}`;
}

function shiftCivil(civil: CivilDate, amount: number, unit: "d" | "w" | "m"): CivilDate {
  if (unit === "m") {
    const total = civil.year * 12 + (civil.month - 1) + amount;
    const year = Math.floor(total / 12);
    const month = (total % 12) + 1;
    return { year, month, day: Math.min(civil.day, daysInMonth(year, month)) };
  }
  const days = unit === "w" ? amount * 7 : amount;
  const shifted = new Date(Date.UTC(civil.year, civil.month - 1, civil.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function isoWeek(civil: CivilDate): number {
  const date = civilToUtcDate(civil);
  const dayIndex = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayIndex + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstIndex = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstIndex + 3);
  return 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
}

function formatCivil(civil: CivilDate, format: FormatName, locale: string): string {
  if (format === "iso") return civilToCalendarDate(civil);
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    ...FORMAT_OPTIONS[format],
  }).format(civilToUtcDate(civil));
}

function parseExpression(inner: string): ParsedExpression | string {
  const compact = inner.replace(/\s+/g, "");
  const match = PARTS.exec(compact);
  if (!match) return "Invalid expression syntax.";
  const [, variable, sign, digits, unit, format] = match;
  if (!(VARIABLES as readonly string[]).includes(variable))
    return `Unknown variable ${variable}.`;
  if (format !== undefined) {
    if (FORMATLESS_VARIABLES.has(variable))
      return `The ${variable} variable does not take a format.`;
    if (!FORMAT_NAMES.includes(format as FormatName))
      return `Unknown format ${format}. Use one of ${FORMAT_NAMES.join(", ")}.`;
  }
  return {
    variable: variable as TemplateVariable,
    amount: sign === undefined ? 0 : Number(digits) * (sign === "-" ? -1 : 1),
    unit: (unit as "d" | "w" | "m") ?? "d",
    format: (format as FormatName) ?? null,
  };
}

function baseCivil(
  variable: TemplateVariable,
  context: ExpressionContext,
): CivilDate | null {
  if (variable === "due_date")
    return context.dueDate === null ? null : civilFromCalendarDate(context.dueDate);
  return civilFromInstant(context.occurrence, context.timeZone);
}

function renderExpression(parsed: ParsedExpression, context: ExpressionContext): string {
  const base = baseCivil(parsed.variable, context);
  if (base === null) return "";
  const civil = parsed.amount === 0 ? base : shiftCivil(base, parsed.amount, parsed.unit);
  if (parsed.variable === "week") return String(isoWeek(civil));
  if (parsed.variable === "weekday") return formatCivil(civil, "weekday", context.locale);
  return formatCivil(civil, parsed.format ?? "iso", context.locale);
}

/**
 * Substitutes every valid expression. Invalid expressions are left verbatim —
 * they are rejected by validation before a template can reach disk, so this
 * path only shows up in live previews of text the author is still typing.
 */
export function renderTemplateText(text: string, context: ExpressionContext): string {
  return text.replace(EXPRESSION, (whole, inner: string) => {
    const parsed = parseExpression(inner);
    return typeof parsed === "string" ? whole : renderExpression(parsed, context);
  });
}

/** Reports every problem in the text, not only the first. */
export function validateTemplateText(text: string): ExpressionIssue[] {
  const issues: ExpressionIssue[] = [];
  for (const match of text.matchAll(EXPRESSION)) {
    const parsed = parseExpression(match[1]);
    if (typeof parsed === "string") issues.push({ expression: match[0], message: parsed });
  }
  return issues;
}

/** Powers the variables panel in the template editor. */
export function describeTemplateVariables(context: ExpressionContext): VariableDescription[] {
  return VARIABLES.map((variable) => {
    const expression = `{{${variable}}}`;
    const preview = renderTemplateText(expression, context);
    return {
      expression,
      description: VARIABLE_DESCRIPTIONS[variable],
      preview: preview === "" ? "—" : preview,
    };
  });
}
