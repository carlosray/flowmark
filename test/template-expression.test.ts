import assert from "node:assert/strict";
import test from "node:test";

import {
  describeTemplateVariables,
  renderTemplateText,
  validateTemplateText,
  type ExpressionContext,
} from "../src/lib/template-expression.ts";

const context: ExpressionContext = {
  occurrence: new Date("2026-08-26T08:00:00Z"),
  dueDate: "2026-08-28",
  timeZone: "UTC",
  locale: "en",
};

test("renders a bare date variable as an ISO calendar date", () => {
  assert.equal(renderTemplateText("{{date}}", context), "2026-08-26");
});

test("applies day arithmetic before formatting", () => {
  assert.equal(renderTemplateText("{{date+2d}}", context), "2026-08-28");
  assert.equal(renderTemplateText("{{date-1d}}", context), "2026-08-25");
});

test("shifts by weeks and months", () => {
  assert.equal(renderTemplateText("{{date+1w}}", context), "2026-09-02");
  assert.equal(renderTemplateText("{{date+1m}}", context), "2026-09-26");
});

test("clamps a month shift onto a shorter month", () => {
  const endOfMonth = { ...context, occurrence: new Date("2026-01-31T08:00:00Z") };
  assert.equal(renderTemplateText("{{date+1m}}", endOfMonth), "2026-02-28");
});

test("names the shifted weekday", () => {
  assert.equal(renderTemplateText("{{weekday}}", context), "Wednesday");
  assert.equal(renderTemplateText("{{weekday+2d}}", context), "Friday");
});

test("renders the resolved due date and tolerates its absence", () => {
  assert.equal(renderTemplateText("{{due_date}}", context), "2026-08-28");
  assert.equal(renderTemplateText("{{due_date}}", { ...context, dueDate: null }), "");
});

test("renders ISO week numbers", () => {
  assert.equal(renderTemplateText("{{week}}", context), "35");
  assert.equal(renderTemplateText("{{week+1w}}", context), "36");
});

test("honours the workspace locale for worded formats", () => {
  assert.equal(renderTemplateText("{{date:long}}", { ...context, locale: "ru" }), "26 августа");
  assert.equal(renderTemplateText("{{date:long}}", context), "August 26");
  assert.equal(renderTemplateText("{{date:month}}", { ...context, locale: "ru" }), "август");
});

test("supports every named format", () => {
  assert.equal(renderTemplateText("{{date:iso}}", context), "2026-08-26");
  assert.equal(renderTemplateText("{{date:short}}", context), "8/26/2026");
  assert.equal(renderTemplateText("{{date:full}}", context), "August 26, 2026");
  assert.equal(renderTemplateText("{{date:weekday}}", context), "Wednesday");
  assert.equal(renderTemplateText("{{date:day}}", context), "26");
  assert.equal(renderTemplateText("{{date:year}}", context), "2026");
});

test("resolves dates in the rule timezone rather than UTC", () => {
  const lateEvening = {
    ...context,
    occurrence: new Date("2026-08-26T23:30:00Z"),
    timeZone: "Europe/Amsterdam",
  };
  assert.equal(renderTemplateText("{{date}}", lateEvening), "2026-08-27");
});

test("leaves surrounding text and unrelated braces untouched", () => {
  assert.equal(renderTemplateText("Piano · {{date}} ok", context), "Piano · 2026-08-26 ok");
  assert.equal(renderTemplateText("{ not an expression }", context), "{ not an expression }");
});

test("tolerates whitespace inside the braces", () => {
  assert.equal(renderTemplateText("{{ date +2d : iso }}", context), "2026-08-28");
});

test("renders several expressions in one string", () => {
  assert.equal(
    renderTemplateText("{{weekday}}, week {{week}}", context),
    "Wednesday, week 35",
  );
});

test("accepts valid text with no issues", () => {
  assert.deepEqual(validateTemplateText("{{date+2d:long}} and {{week}}"), []);
  assert.deepEqual(validateTemplateText("no expressions here"), []);
});

test("reports an unknown variable", () => {
  const issues = validateTemplateText("{{nope}}");
  assert.equal(issues.length, 1);
  assert.equal(issues[0].expression, "{{nope}}");
  assert.match(issues[0].message, /unknown variable/i);
});

test("reports an unknown format", () => {
  assert.match(validateTemplateText("{{date:nonsense}}")[0].message, /format/i);
});

test("reports a format applied to a variable that takes none", () => {
  assert.match(validateTemplateText("{{week:long}}")[0].message, /week/i);
  assert.match(validateTemplateText("{{weekday:iso}}")[0].message, /weekday/i);
});

test("reports malformed arithmetic", () => {
  assert.match(validateTemplateText("{{date+2}}")[0].message, /expression/i);
  assert.match(validateTemplateText("{{date+xd}}")[0].message, /expression/i);
});

test("reports every issue in a string, not only the first", () => {
  assert.equal(validateTemplateText("{{nope}} {{alsonope}}").length, 2);
});

test("renders text containing an invalid expression verbatim", () => {
  assert.equal(renderTemplateText("{{nope}}", context), "{{nope}}");
});

test("describes every variable with a live preview", () => {
  const described = describeTemplateVariables(context);
  const expressions = described.map((entry) => entry.expression);
  assert.deepEqual(expressions, ["{{date}}", "{{due_date}}", "{{weekday}}", "{{week}}"]);
  for (const entry of described) {
    assert.ok(entry.description.length > 0);
    assert.ok(entry.preview.length > 0);
  }
});
