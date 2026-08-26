# Scheduled Card Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a scheduled rule create cards from a reusable template whose title, body, checklist, and due date are expressed relative to the moment the rule fires, and let the user decide what to do about occurrences missed while the machine was off.

**Architecture:** A pure expression engine renders `{{...}}` in template text; a pure occurrence engine turns a schedule trigger into a list of instants; the rule runner gains a board-level action phase that instantiates templates; a watermark in `.flowmark/jobs/` plus a canonical `origin` marker on created cards make backfill both possible and duplicate-proof.

**Tech Stack:** TypeScript, TanStack Start + React 19, `yaml`, `croner`, `Intl.DateTimeFormat`, `node:test` + `node:assert/strict` run under `bun test`.

**Spec:** `docs/plans/2026-08-26-scheduled-card-templates-design.md`

## Global Constraints

- No new runtime dependencies. Date formatting uses `Intl.DateTimeFormat`; `date-fns` stays a transitive dependency of `react-day-picker` and must not be imported from `src/`.
- The filesystem stays the database. `.flowmark/` holds only the watermark and must remain safe to delete.
- Resource IDs are immutable, lowercase, prefixed: `template_[a-z0-9_]+`, `rule_[a-z0-9_]+`, `card_[a-z0-9_]+`.
- All file mutation goes through `FileMutation` in `src/lib/workspace/file-transaction.ts`.
- Tests are `node:test` with `node:assert/strict`, placed flat in `test/`, run with `bun test test`.
- Before handoff: `bun run test`, `bun run typecheck`, `bun run lint`, `bun run format:check`, `bun run build`.
- Existing workspaces must keep validating. Every new card and rule field is optional or additive.

---

## File Structure

**Create:**

- `src/lib/template-expression.ts` — parse, validate, and render `{{...}}` expressions. Pure, no fs, imported by both server and client.
- `src/lib/workspace/schedule.ts` — turn a schedule trigger into occurrence instants. Pure, no fs.
- `src/lib/workspace/templates-repository.ts` — read and write template resources.
- `src/lib/workspace/template-instantiation.ts` — render a template into a concrete card and its checklist.
- `src/lib/workspace/schedule-state.ts` — read and write the `.flowmark/jobs/` watermark, and compute pending occurrences.
- `src/lib/templates.functions.ts` — server functions for the template editor.
- `src/lib/schedule.functions.ts` — server functions for the missed-occurrence queue.
- `src/lib/templates.ts` — client store for templates.
- `src/lib/missed-occurrences.ts` — client store for the pending queue.
- `src/components/board/TemplatesButton.tsx` — header button plus template list modal.
- `src/components/board/TemplateEditorModal.tsx` — card-shaped template editor.
- `src/components/board/TemplateDuePicker.tsx` — `none | offset | fixed` due selector.
- `src/components/board/TemplateVariablesPanel.tsx` — variable reference with live values.
- `src/components/board/MissedOccurrencesDialog.tsx` — pending-occurrence prompt.

**Modify:**

- `src/lib/workspace/schema-catalog.ts` — template becomes markdown-with-frontmatter; `card.origin`; `create_card`; `ui.locale`.
- `src/lib/workspace/validator.ts` — template parsing from `.md`, new diagnostics.
- `src/lib/workspace/board-repository.ts` — preserve unknown card source fields in `yamlCard`; protect referenced templates.
- `src/lib/workspace/rule-runner.ts` — board-level action phase, `every` timers.
- `src/lib/workspace/rules-repository.ts` — map `schedule` triggers and `create_card` both ways.
- `src/lib/rule-model.ts`, `src/lib/rules-ui.ts` — schedule trigger and create-card action in the editor model.
- `src/components/board/Board.tsx` — mount `TemplatesButton` and `MissedOccurrencesDialog`.
- `docs/rules.md`, `docs/workspace-format.md`, `AGENTS.md`, `src/lib/workspace/initializer.ts`.

---

### Task 1: Expression engine

**Files:**

- Create: `src/lib/template-expression.ts`
- Test: `test/template-expression.test.ts`

**Interfaces:**

- Produces:
  ```ts
  export interface ExpressionContext {
    occurrence: Date;
    dueDate: string | null; // calendar date or null
    timeZone: string;
    locale: string;
  }
  export interface ExpressionIssue {
    expression: string;
    message: string;
  }
  export const TEMPLATE_VARIABLES: readonly string[];
  export function renderTemplateText(text: string, context: ExpressionContext): string;
  export function validateTemplateText(text: string): ExpressionIssue[];
  export function describeTemplateVariables(
    context: ExpressionContext,
  ): Array<{ expression: string; description: string; preview: string }>;
  ```

Grammar: `{{` optional space, variable name, optional `±N` followed by `d`/`w`/`m`, optional `:` format, optional space, `}}`. Unrecognised content is reported, never silently emitted.

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  renderTemplateText,
  validateTemplateText,
  describeTemplateVariables,
} from "../src/lib/template-expression.ts";

const context = {
  occurrence: new Date("2026-08-26T08:00:00Z"),
  dueDate: "2026-08-28",
  timeZone: "UTC",
  locale: "en",
};

test("renders a bare date variable as ISO", () => {
  assert.equal(renderTemplateText("{{date}}", context), "2026-08-26");
});

test("applies day arithmetic before formatting", () => {
  assert.equal(renderTemplateText("{{date+2d:iso}}", context), "2026-08-28");
  assert.equal(renderTemplateText("{{date-1d:iso}}", context), "2026-08-25");
});

test("shifts by weeks and months", () => {
  assert.equal(renderTemplateText("{{date+1w:iso}}", context), "2026-09-02");
  assert.equal(renderTemplateText("{{date+1m:iso}}", context), "2026-09-26");
});

test("names the shifted weekday", () => {
  assert.equal(renderTemplateText("{{weekday}}", context), "Wednesday");
  assert.equal(renderTemplateText("{{weekday+2d}}", context), "Friday");
});

test("renders the resolved due date", () => {
  assert.equal(renderTemplateText("{{due_date}}", context), "2026-08-28");
  assert.equal(renderTemplateText("{{due_date}}", { ...context, dueDate: null }), "");
});

test("renders ISO week numbers", () => {
  assert.equal(renderTemplateText("{{week}}", context), "35");
});

test("honours the locale for long formats", () => {
  assert.equal(renderTemplateText("{{date:long}}", { ...context, locale: "ru" }), "26 августа");
});

test("leaves surrounding text untouched", () => {
  assert.equal(renderTemplateText("Piano · {{date:iso}} ok", context), "Piano · 2026-08-26 ok");
});

test("reports unknown variables instead of rendering them", () => {
  const issues = validateTemplateText("{{nope}}");
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /unknown variable/i);
});

test("rejects arithmetic on a non-date variable", () => {
  assert.match(validateTemplateText("{{week+2d}}")[0].message, /week/i);
});

test("rejects an unknown format", () => {
  assert.match(validateTemplateText("{{date:nonsense}}")[0].message, /format/i);
});

test("accepts valid text with no issues", () => {
  assert.deepEqual(validateTemplateText("{{date+2d:long}} and {{week}}"), []);
});

test("describes every variable with a preview", () => {
  const described = describeTemplateVariables(context);
  assert.ok(described.some((entry) => entry.expression === "{{date}}"));
  assert.ok(
    described.every((entry) => entry.preview.length > 0 || entry.expression.includes("due")),
  );
});
```

- [ ] **Step 2: Run and confirm failure** — `bun test test/template-expression.test.ts`, expect module-not-found.
- [ ] **Step 3: Implement** the tokenizer, arithmetic in the target timezone via `Intl.DateTimeFormat` parts, and the named-format table (`iso`, `short`, `long`, `full`, `weekday`, `day`, `month`, `year`). `week` computes the ISO week number.
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit** — `git commit -m "Add template expression engine"`

---

### Task 2: Occurrence engine

**Files:**

- Create: `src/lib/workspace/schedule.ts`
- Test: `test/schedule.test.ts`

**Interfaces:**

- Produces:
  ```ts
  export interface ScheduleTrigger {
    type: "schedule";
    cron?: string;
    every?: { days?: number; weeks?: number; anchor: string; at?: string };
    timezone?: string;
  }
  export function parseScheduleTrigger(value: unknown): ScheduleTrigger | null;
  export function occurrencesBetween(
    trigger: ScheduleTrigger,
    after: Date,
    until: Date,
    timeZone: string,
    limit?: number,
  ): Date[];
  export function nextOccurrenceAfter(
    trigger: ScheduleTrigger,
    after: Date,
    timeZone: string,
  ): Date | null;
  ```

`occurrencesBetween` is exclusive of `after` and inclusive of `until`. `limit` defaults to 500 and caps runaway backfill.

- [ ] **Step 1: Write the failing test**

```ts
test("cron occurrences respect the pattern", () => {
  const trigger = { type: "schedule", cron: "0 8 * * 2,4" } as const;
  const found = occurrencesBetween(
    trigger,
    new Date("2026-08-24T00:00:00Z"),
    new Date("2026-09-01T00:00:00Z"),
    "UTC",
  );
  assert.deepEqual(
    found.map((d) => d.toISOString()),
    ["2026-08-25T08:00:00.000Z", "2026-08-27T08:00:00.000Z"],
  );
});

test("every-days keeps a constant interval across a month boundary", () => {
  const trigger = {
    type: "schedule",
    every: { days: 3, anchor: "2026-08-19", at: "08:00" },
  } as const;
  const found = occurrencesBetween(
    trigger,
    new Date("2026-08-19T08:00:00Z"),
    new Date("2026-09-05T00:00:00Z"),
    "UTC",
  );
  assert.deepEqual(
    found.map((d) => d.toISOString().slice(0, 10)),
    ["2026-08-22", "2026-08-25", "2026-08-28", "2026-08-31", "2026-09-03"],
  );
});

test("every-weeks steps by seven days", () => {
  const trigger = {
    type: "schedule",
    every: { weeks: 2, anchor: "2026-08-19", at: "09:30" },
  } as const;
  const found = occurrencesBetween(
    trigger,
    new Date("2026-08-19T00:00:00Z"),
    new Date("2026-10-01T00:00:00Z"),
    "UTC",
  );
  assert.deepEqual(
    found.map((d) => d.toISOString().slice(0, 10)),
    ["2026-08-19", "2026-09-02", "2026-09-16", "2026-09-30"],
  );
});

test("occurrences before the anchor are not produced", () => {
  const trigger = { type: "schedule", every: { days: 3, anchor: "2026-08-19" } } as const;
  assert.deepEqual(
    occurrencesBetween(
      trigger,
      new Date("2026-08-01T00:00:00Z"),
      new Date("2026-08-19T00:00:00Z"),
      "UTC",
    ),
    [],
  );
});

test("every-days holds local wall-clock time across a DST shift", () => {
  const trigger = {
    type: "schedule",
    every: { days: 1, anchor: "2026-10-24", at: "08:00" },
  } as const;
  const found = occurrencesBetween(
    trigger,
    new Date("2026-10-24T00:00:00Z"),
    new Date("2026-10-27T00:00:00Z"),
    "Europe/Amsterdam",
  );
  const local = found.map((d) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Amsterdam",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d),
  );
  assert.deepEqual(local, ["08:00", "08:00", "08:00"]);
});

test("the limit caps the returned occurrences", () => {
  const trigger = { type: "schedule", every: { days: 1, anchor: "2020-01-01" } } as const;
  assert.equal(
    occurrencesBetween(
      trigger,
      new Date("2020-01-01T00:00:00Z"),
      new Date("2026-01-01T00:00:00Z"),
      "UTC",
      10,
    ).length,
    10,
  );
});

test("parseScheduleTrigger rejects both cron and every", () => {
  assert.equal(
    parseScheduleTrigger({
      type: "schedule",
      cron: "0 8 * * *",
      every: { days: 1, anchor: "2026-08-19" },
    }),
    null,
  );
});

test("nextOccurrenceAfter finds the following instant", () => {
  const trigger = { type: "schedule", every: { days: 3, anchor: "2026-08-19", at: "08:00" } };
  assert.equal(
    nextOccurrenceAfter(trigger, new Date("2026-08-23T00:00:00Z"), "UTC")?.toISOString(),
    "2026-08-25T08:00:00.000Z",
  );
});
```

- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Implement.** Cron uses `new Cron(pattern, { timezone, paused: true }).nextRun(cursor)` in a loop. `every` walks calendar days from the anchor with `calendarDateAtOffset`, then resolves each local date plus `at` into an instant in the target timezone.
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit** — `git commit -m "Add schedule occurrence engine"`

---

### Task 3: Format and validation

**Files:**

- Modify: `src/lib/workspace/schema-catalog.ts`, `src/lib/workspace/validator.ts`
- Test: `test/workspace.test.ts`, `test/schema-catalog.test.ts`

Changes:

1. `templateSchema` becomes `format: "markdown-with-yaml-frontmatter"` with a body; `COMPONENT_FIELDS.template` unchanged.
2. `COMPONENT_FIELDS.card` gains `origin`; `cardSchema` gains an optional `origin` object.
3. `ui.locale` added as an optional workspace field.
4. `RULE_ACTION_TYPES` gains `create_card` (in `src/lib/rule-model.ts`, imported by the validator).
5. `validator.ts` reads templates from `<templatesDir>/*.md` with frontmatter instead of `*.yaml`.

New diagnostics:

| Code                            | Condition                                                                           |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| `E_INVALID_FIELD_TYPE`          | `card` not a mapping; `checklist` not a list of strings                             |
| `E_REQUIRED_FIELD`              | `card.title` missing or empty                                                       |
| `E_INVALID_TEMPLATE_EXPRESSION` | any expression issue in title, body, or checklist                                   |
| `E_INVALID_TEMPLATE_DUE`        | `due.mode` unknown, or fields inconsistent with the mode                            |
| `E_UNKNOWN_REFERENCE`           | `card.column_id` or a `card.tag_ids` entry missing                                  |
| `E_INVALID_RULE_ACTION`         | `create_card` without `template_id`, or with a missing template                     |
| `E_INVALID_RULE_ACTION`         | `create_card` under a non-schedule trigger                                          |
| `E_INVALID_RULE_ACTION`         | `create_card` in a rule that has `conditions`                                       |
| `E_INVALID_RULE_TRIGGER`        | `schedule` with neither or both of `cron`/`every`; bad `days`/`weeks`/`anchor`/`at` |
| `E_INVALID_FIELD_TYPE`          | `card.origin` present but not a well-formed mapping                                 |

- [ ] **Step 1: Write failing tests** covering each row above plus: a valid template workspace validates clean; an existing workspace with no templates still validates; a card carrying `origin` validates.
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Implement** the catalog and validator changes.
- [ ] **Step 4: Run and confirm pass**, including the whole existing `test/workspace.test.ts`.
- [ ] **Step 5: Commit** — `git commit -m "Validate markdown templates and card creation rules"`

---

### Task 4: Preserve unknown card source fields

**Files:**

- Modify: `src/lib/workspace/board-repository.ts` (`yamlCard`, around line 112)
- Test: `test/workspace.test.ts`

`yamlCard` rebuilds frontmatter from a fixed shape, so `origin` would be erased on the next board write. Columns, tags, and rules already spread their source; cards must too.

- [ ] **Step 1: Write the failing test**

```ts
test("board writes preserve unknown card frontmatter fields", async () => {
  // card_test.md carries origin.rule_id / origin.occurrence
  const board = await readWorkspaceBoard(root);
  board.cards.card_test.title = "Renamed";
  await writeWorkspaceBoard(root, board);
  const written = parse((await readFile(join(root, "cards/card_test.md"), "utf8")).split("---")[1]);
  assert.equal(written.origin.rule_id, "rule_piano");
  assert.equal(written.origin.occurrence, "2026-08-22T08:00:00Z");
});
```

- [ ] **Step 2: Run and confirm failure** — origin is undefined.
- [ ] **Step 3: Implement** — thread the existing card source into `yamlCard` and spread it first, exactly as `columnSourceFields` does.
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit** — `git commit -m "Preserve unknown card frontmatter on board writes"`

---

### Task 5: Templates repository

**Files:**

- Create: `src/lib/workspace/templates-repository.ts`
- Modify: `src/lib/workspace/board-repository.ts` (template-reference protection)
- Test: `test/templates-repository.test.ts`

**Interfaces:**

- Produces:

  ```ts
  export interface TemplateDue {
    mode: "none" | "offset" | "fixed";
    offsetDays?: number;
    date?: string;
  }
  export interface CardTemplate {
    id: string;
    name: string;
    title: string;
    body: string;
    columnId: string | null;
    tagIds: string[];
    due: TemplateDue;
    checklist: string[];
  }
  export const TEMPLATE_ID_PATTERN: RegExp;
  export function createTemplateId(): string;
  export function readWorkspaceTemplates(
    root: string,
  ): Promise<{ path: string; templates: CardTemplate[]; locale: string; timeZone: string }>;
  export function writeWorkspaceTemplates(
    root: string,
    request: { templates: CardTemplate[]; deletedIds: string[] },
    now?: Date,
  ): Promise<{ path: string }>;
  ```

- [ ] **Step 1: Write failing tests** — round-trip a template through write and read; writing validates the workspace afterwards and rolls back on failure; deleting a template referenced by a rule throws; unknown frontmatter fields survive a rewrite.
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Implement** using `FileMutation`, mirroring `rules-repository.ts` including the validate-then-commit ordering.
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit** — `git commit -m "Add templates repository"`

---

### Task 6: Template instantiation

**Files:**

- Create: `src/lib/workspace/template-instantiation.ts`
- Test: `test/template-instantiation.test.ts`

**Interfaces:**

- Consumes: `CardTemplate` (Task 5), `renderTemplateText` (Task 1).
- Produces:
  ```ts
  export interface InstantiationRequest {
    template: CardTemplate;
    ruleId: string;
    occurrence: Date;
    timeZone: string;
    locale: string;
    columnIdOverride?: string | null;
    defaultColumnId: string;
  }
  export interface InstantiatedCard {
    cardId: string;
    title: string;
    body: string;
    columnId: string;
    tagIds: string[];
    dueDate: string | null;
    checklist: string[];
    origin: { rule_id: string; template_id: string; occurrence: string };
  }
  export function instantiateTemplate(request: InstantiationRequest): InstantiatedCard;
  ```

Due resolution runs first, because `{{due_date}}` must be renderable in the title.

- [ ] **Step 1: Write failing tests** — offset due resolves relative to the occurrence date in the rule timezone; fixed due passes through; `none` yields null; the column override beats the template which beats the workspace default; `{{due_date}}` in the title renders the resolved date; checklist entries render.
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit** — `git commit -m "Instantiate cards from templates"`

---

### Task 7: Watermark and pending occurrences

**Files:**

- Create: `src/lib/workspace/schedule-state.ts`
- Test: `test/schedule-state.test.ts`

**Interfaces:**

- Consumes: `occurrencesBetween` (Task 2).
- Produces:
  ```ts
  export const PENDING_SERIES_THRESHOLD = 20;
  export interface PendingOccurrence {
    ruleId: string;
    ruleName: string;
    templateId: string;
    occurrence: string;
    title: string;
  }
  export interface PendingSeries {
    ruleId: string;
    ruleName: string;
    templateId: string;
    occurrences: string[];
    collapsed: boolean;
  }
  export function readWatermark(root: string, ruleId: string): Promise<string | null>;
  export function writeWatermark(root: string, ruleId: string, occurrence: string): Promise<void>;
  export function resolveWatermark(
    root: string,
    ruleId: string,
    ruleCreatedAt: string,
  ): Promise<string>;
  export function pendingOccurrences(root: string, now?: Date): Promise<PendingSeries[]>;
  ```

`resolveWatermark` falls back to the newest `origin.occurrence` across cards and archive for that rule, then to `ruleCreatedAt`.

- [ ] **Step 1: Write failing tests** — watermark round-trip; rebuild from card origins after `.flowmark/` is removed; the `created_at` floor stops backfill for a brand-new rule; a rule pending more than twenty occurrences comes back `collapsed: true`; a disabled rule produces nothing.
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit** — `git commit -m "Track scheduled rule watermarks"`

---

### Task 8: Rule runner board-level phase

**Files:**

- Modify: `src/lib/workspace/rule-runner.ts`
- Test: `test/rule-runner.test.ts`

**Interfaces:**

- Produces:
  ```ts
  export function runScheduledRule(root: string, ruleId: string, now?: Date): Promise<number>;
  export function createCardForOccurrence(
    root: string,
    ruleId: string,
    occurrence: Date,
  ): Promise<string | null>; // created card id, or null when already present
  ```

`runScheduledRule` splits into a board-level phase (`create_card`, `sort_cards`) run once, then the existing per-card loop. Created cards emit `card.created` into `derivedEvents` so event rules cascade. `startWorkspaceJobs` arms `croner` for `cron` triggers and a self-re-arming timer for `every`, and the returned stop function clears both.

- [ ] **Step 1: Write failing tests** — a scheduled `create_card` rule creates a card in the template's column with the rendered title and the `origin` marker; a second run for the same occurrence creates nothing; a `card_created` event rule moves the new card; an `every` trigger fires on its interval; the stop function halts timers; existing rule-runner tests still pass unchanged.
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit** — `git commit -m "Create cards from scheduled rules"`

---

### Task 9: Server functions

**Files:**

- Create: `src/lib/templates.functions.ts`, `src/lib/schedule.functions.ts`
- Test: covered through Tasks 5, 7, 8 plus a smoke test in `test/schedule-state.test.ts`

**Interfaces:**

- Produces:
  ```ts
  // templates.functions.ts
  getTemplatesFile(): Promise<{ path: string; json: string; locale: string; timeZone: string }>;
  saveTemplatesFile(input: { data: { json: string; deletedIds: string[] } }):
    Promise<{ path: string }>;
  // schedule.functions.ts
  getPendingOccurrences(): Promise<{ series: PendingSeries[] }>;
  resolvePendingOccurrence(input: { data: {
    ruleId: string;
    decision: "repeat" | "skip" | "repeat_series" | "decline_series";
    occurrence: string;
  }}): Promise<{ created: string[] }>;
  ```

Follow the existing `rules.functions.ts` shape exactly, including how the workspace root is resolved.

- [ ] **Step 1: Write the failing test** for `resolvePendingOccurrence` — `repeat` creates one card and advances the watermark; `skip` creates none and still advances; `repeat_series` creates all pending for that rule; `decline_series` creates none and advances past the last.
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit** — `git commit -m "Expose template and schedule server functions"`

---

### Task 10: Schedule rules in the editor model

**Files:**

- Modify: `src/lib/rule-model.ts`, `src/lib/rules-ui.ts`, `src/lib/workspace/rules-repository.ts`
- Test: `test/rule-model.test.ts`, `test/rules-repository.test.ts`

**Interfaces:**

- Produces:
  ```ts
  type RuleTrigger =
    | ...existing...
    | { kind: "schedule"; cron: string }
    | { kind: "scheduleEvery"; days: number; anchor: string; at: string };
  type RuleAction =
    | ...existing...
    | { kind: "createCard"; templateId: string; columnId: string | null };
  ```

`uiRule` currently returns `null` for `schedule`, hiding such rules from the editor. Both directions must now map, and `validateUiRule` must enforce the same constraints the file validator does.

- [ ] **Step 1: Write failing tests** — a YAML schedule rule with `create_card` round-trips through `uiRule` and `sourceRule`; the editor refuses to save `createCard` alongside conditions; the editor refuses `createCard` on a non-schedule trigger; rules the editor cannot represent are still preserved on save.
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit** — `git commit -m "Edit scheduled card-creation rules visually"`

---

### Task 11: Template editor interface

**Files:**

- Create: `src/lib/templates.ts`, `src/components/board/TemplatesButton.tsx`, `TemplateEditorModal.tsx`, `TemplateDuePicker.tsx`, `TemplateVariablesPanel.tsx`
- Modify: `src/components/board/Board.tsx`
- Test: `test/templates-editor.test.tsx`

The list modal mirrors `RulesButton`. The editor reuses `EditableMarkdown`, `TagPicker`, and `ChecklistItemText`. The variables panel occupies the position comments hold on a card and shows each expression with its value resolved for the current moment.

- [ ] **Step 1: Write failing tests** — the button renders a count; opening the list and a row opens the editor; editing the title and saving persists through the store; the variables panel lists every expression with a non-empty preview; the due picker switches between the three modes; an invalid expression blocks saving and surfaces the message.
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit** — `git commit -m "Add the card template editor"`

---

### Task 12: Missed-occurrence prompt

**Files:**

- Create: `src/lib/missed-occurrences.ts`, `src/components/board/MissedOccurrencesDialog.tsx`
- Modify: `src/components/board/Board.tsx`
- Test: `test/missed-occurrences.test.tsx`

One question at a time. Four actions: Repeat (focused by default, so Enter accepts), Skip, Repeat the whole series, Decline the whole series. Escape defers without deciding. A collapsed series shows the count and date range instead of one prompt per occurrence.

- [ ] **Step 1: Write failing tests** — the dialog appears only when the queue is non-empty; Repeat has initial focus and Enter triggers it; each action calls `resolvePendingOccurrence` with the right decision; after the last occurrence the dialog closes; Escape closes without resolving anything; a collapsed series renders one prompt naming the range.
- [ ] **Step 2: Run and confirm failure.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run and confirm pass.**
- [ ] **Step 5: Commit** — `git commit -m "Prompt for missed scheduled occurrences"`

---

### Task 13: Documentation and full verification

**Files:**

- Modify: `docs/rules.md`, `docs/workspace-format.md`, `AGENTS.md`, `src/lib/workspace/initializer.ts`
- Create: `example/templates/template_piano.md`, `example/rules/rule_piano.yaml`

- [ ] **Step 1** — document the `create_card` action, the `every` schedule, the template component, the expression table, and the missed-occurrence behaviour.
- [ ] **Step 2** — add the worked example to the example workspace and confirm `flowmark validate` passes against it.
- [ ] **Step 3** — run `bun run test`, `bun run typecheck`, `bun run lint`, `bun run format:check`, `bun run build`.
- [ ] **Step 4: Commit** — `git commit -m "Document scheduled card templates"`

---

## Self-Review

**Spec coverage:** template resource → Tasks 3, 5; expression language → Task 1; due specification → Task 6; origin marker → Tasks 3, 4; rule extensions → Tasks 3, 10; occurrence computation → Task 2; board-level actions → Task 8; missed occurrences → Tasks 7, 9, 12; templates interface → Task 11; rule editor → Task 10; validation → Task 3; documentation → Task 13. No section is unimplemented.

**Type consistency:** `CardTemplate` is defined in Task 5 and consumed unchanged in Tasks 6, 9, 11. `PendingSeries` is defined in Task 7 and consumed in Tasks 9 and 12. `ExpressionContext` is defined in Task 1 and consumed in Tasks 6 and 11. `occurrencesBetween` keeps one signature across Tasks 2, 7, and 8.

**Ordering:** Tasks 1 and 2 are pure and independent. Tasks 3 and 4 touch the format. Tasks 5 through 9 build the server. Tasks 10 through 12 build the interface. Task 13 closes out.
