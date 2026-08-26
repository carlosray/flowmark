import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ruleActionOptions, ruleTriggerOptions } from "../src/lib/rules-ui.ts";

async function source(path: string) {
  return readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
}

test("the rule editor offers both schedule forms", () => {
  const kinds = ruleTriggerOptions().map(([kind]) => kind);
  assert.ok(kinds.includes("schedule"));
  assert.ok(kinds.includes("scheduleEvery"));
});

test("card creation is offered only on a schedule and only with templates", () => {
  const has = (scope: Parameters<typeof ruleActionOptions>[1]) =>
    ruleActionOptions(true, scope).some(([kind]) => kind === "createCard");
  assert.equal(has({ hasTemplates: true, onSchedule: true }), true);
  assert.equal(has({ hasTemplates: false, onSchedule: true }), false);
  assert.equal(has({ hasTemplates: true, onSchedule: false }), false);
  assert.equal(has({}), false);
});

test("the board mounts the templates button and the missed-occurrence dialog", async () => {
  const board = await source("components/board/Board.tsx");
  assert.match(board, /<TemplatesButton \/>/);
  assert.match(board, /<MissedOccurrencesDialog \/>/);
});

test("the template editor reuses the card primitives and labels its controls", async () => {
  const editor = await source("components/board/TemplateEditorModal.tsx");
  assert.match(editor, /<EditableMarkdown/);
  assert.match(editor, /<TemplateDuePicker/);
  assert.match(editor, /<TemplateVariablesPanel/);
  assert.match(editor, /<TagPill/);
  for (const label of [
    "Template name",
    "Card title template",
    "Target column",
    "New checklist item",
  ])
    assert.match(editor, new RegExp(`aria-label="${label}"`), `missing label ${label}`);
  assert.match(editor, /ariaLabel="Template description"/);
});

test("the template editor blocks saving while a template has issues", async () => {
  const editor = await source("components/board/TemplateEditorModal.tsx");
  assert.match(editor, /disabled=\{issues\.length > 0\}/);
  assert.match(editor, /templateIssues\(draft\)/);
});

test("a template carries no conversation and no completion state", async () => {
  const editor = await source("components/board/TemplateEditorModal.tsx");
  for (const forbidden of [/draft\.comments/, /draft\.completed/, /<Comment/, /MessageSquare/])
    assert.doesNotMatch(editor, forbidden);
});

test("the due picker exposes all three modes with labelled controls", async () => {
  const picker = await source("components/board/TemplateDuePicker.tsx");
  assert.match(picker, /aria-label="Due date mode"/);
  assert.match(picker, /aria-label="Days from creation"/);
  assert.match(picker, /<DueDatePicker/);
});

test("the missed-occurrence dialog defaults focus to the preferred answer", async () => {
  const dialog = await source("components/board/MissedOccurrencesDialog.tsx");
  assert.match(dialog, /defaultDecisionFor\(item\)/);
  assert.match(dialog, /ref=\{decision === preferred \? defaultButton : undefined\}/);
  assert.match(dialog, /defaultButton\.current\?\.focus\(\)/);
});

test("Escape defers the missed-occurrence queue rather than declining it", async () => {
  const dialog = await source("components/board/MissedOccurrencesDialog.tsx");
  assert.match(dialog, /event\.key === "Escape"[\s\S]{0,80}dismiss\(\)/);
});

test("the missed-occurrence dialog renders one question at a time", async () => {
  const dialog = await source("components/board/MissedOccurrencesDialog.tsx");
  assert.match(dialog, /const item = snapshot\.queue\[0\]/);
  assert.match(dialog, /if \(!item\) return null/);
  assert.match(dialog, /occurrenceDecisionOptions\(item\.collapsed\)/);
});

test("the templates list opens each template in the card-shaped editor", async () => {
  const list = await source("components/board/TemplatesButton.tsx");
  assert.match(list, /<TemplateEditorModal/);
  assert.match(list, /createTemplateId\(\)/);
  assert.match(list, /templatesStore\.remove/);
});

test("client template code never imports the filesystem repository as a value", async () => {
  for (const path of [
    "components/board/TemplatesButton.tsx",
    "components/board/TemplateEditorModal.tsx",
    "components/board/TemplateDuePicker.tsx",
    "components/board/MissedOccurrencesDialog.tsx",
    "lib/templates-ui.ts",
    "lib/missed-occurrences.ts",
  ]) {
    const text = await source(path);
    const valueImports = [
      ...text.matchAll(/^import (?!type )[^;]*from "([^"]*workspace[^"]*)";$/gm),
    ];
    assert.deepEqual(
      valueImports.map((match) => match[1]),
      [],
      `${path} must not pull workspace filesystem code into the browser bundle`,
    );
  }
});

test("the rule editor edits both schedule forms and the create-card action", async () => {
  const rules = await source("components/board/RulesButton.tsx");
  for (const label of [
    "Cron expression",
    "Interval count",
    "Interval unit",
    "Interval anchor date",
    "Interval time of day",
    "Card template",
    "Created card column",
  ])
    assert.match(rules, new RegExp(`ariaLabel="${label}"|aria-label="${label}"`), label);
  assert.match(rules, /hasTemplates: templates\.length > 0/);
  assert.match(rules, /onSchedule: isScheduleTrigger\(rule\.trigger\)/);
});
