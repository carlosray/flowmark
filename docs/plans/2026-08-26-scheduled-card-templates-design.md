# Scheduled card templates — design

## Problem

Flowmark can automate cards that already exist, but it cannot bring one into
being. Recurring commitments — practise piano every day, review the backlog on
Tuesdays and Thursdays, run a retro every second Friday — have no home. The user
must remember to create the card, which is exactly the memory work the board is
supposed to absorb.

Two capabilities are missing:

1. A reusable description of a card that does not exist yet: title, body, tags,
   checklist, and a due date expressed relative to creation rather than as a
   fixed calendar date.
2. A scheduled rule action that instantiates that description, reliably, even
   when the machine was switched off at the scheduled moment.

## Existing ground

- `trigger.type: schedule` with a `cron` field already exists and is validated
  (`validator.ts` `validateRule`), and `startWorkspaceJobs` already runs such
  rules through `croner`.
- A `template` component is already declared in the workspace format
  (`templates/*.yaml`, fields `name`, `card`, `checklist`) and validated, but
  nothing reads it. `example/templates/` is empty and no fixture uses it.
- Scheduled rule execution in `runScheduledRule` is card-centric: it iterates
  existing cards and applies per-card actions to each match.
- The visual rule editor cannot represent `schedule` rules at all: `uiRule` in
  `rules-repository.ts` returns `null` for that trigger, so such rules are
  invisible in the UI and survive only because the writer preserves rules it
  does not manage.
- `yamlCard` in `board-repository.ts` rebuilds card frontmatter from a fixed
  shape and drops unknown source fields, unlike the column and rule writers,
  which spread the existing source.

## Model

### Template resource

Templates move from `templates/*.yaml` to `templates/*.md`, using the
`markdown-with-yaml-frontmatter` format that the schema catalog already supports
for cards and comments. The Markdown body is the card description template, so
it is stored as Markdown rather than as a YAML block scalar, and the existing
`EditableMarkdown` editor applies unchanged.

The component has no adopters — no UI ever produced one, the example workspace
ships an empty directory, and no fixture references one — so the format change
costs nothing and is not a compatibility break in practice.

```markdown
<!-- templates/template_piano.md -->
---
schema_version: 1
id: template_piano
name: Практика пианино
card:
  title: "Пианино · {{date+2d:long}}"
  column_id: column_to_plan
  tag_ids: [tag_music]
  due:
    mode: offset
    offset_days: 2
checklist:
  - "Гаммы 10 минут"
  - "Пьеса недели {{week}}"
created_at: 2026-08-26T09:00:00Z
updated_at: 2026-08-26T09:00:00Z
---

Занятие на {{weekday+2d}}. Неделя {{week}}.
```

Fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | yes | Display name in the template list. Not a card field. |
| `card.title` | yes | Title template. Must be non-empty after rendering. |
| `card.column_id` | no | Target column. Falls back to `defaults.initial_column_id`. |
| `card.tag_ids` | no | Tags applied to the created card. |
| `card.due` | no | Due-date specification, below. Absent means no due date. |
| `checklist` | no | List of checklist item templates, rendered like the body. |
| body | no | Card description template. |

### Due specification

```yaml
due:
  mode: none | offset | fixed
  offset_days: 2        # mode: offset only, integer, may be negative
  date: 2026-09-01      # mode: fixed only, calendar date
```

`mode: offset` resolves against the occurrence date in the rule's timezone, so
a rule that fires two days before the session produces a card already dated for
the session. `mode: none` is equivalent to omitting `due` and exists so the UI
has a value to bind to.

The shape deliberately mirrors the existing `set_due_date` action
(`mode: end_of_day | offset`) rather than inventing a second vocabulary.
`mode: none` has no `set_due_date` analogue because clearing is a separate
action there; the difference is intentional and documented.

### Expression language

Text fields — `card.title`, the body, and each `checklist` entry — support
substitution:

```
{{ variable [±N(d|w|m)] [:format] }}
```

Everything resolves against the occurrence instant, interpreted in the rule's
timezone.

Every variable is a projection of one underlying date. Arithmetic shifts that
date; the variable then reports its own aspect of the result. This keeps the
model uniform — there are no variable/operator combinations to forbid.

| Variable | Underlying date | Renders | Takes a format |
| --- | --- | --- | --- |
| `date` | the occurrence date | the date itself | yes |
| `due_date` | the resolved due date | the date itself, or empty when `mode: none` | yes |
| `weekday` | the occurrence date | the day-of-week name | no |
| `week` | the occurrence date | the ISO week number | no |

Arithmetic is `±N` followed by `d` (days), `w` (weeks), or `m` (months), and
applies to any variable. `{{weekday+2d}}` names the day two days after the
occurrence; `{{week+1w}}` gives next week's number.

`month` and `year` are formats rather than variables: `{{date:month}}` and
`{{date:year}}` cover what separate variables would have, without a second way
to say the same thing.

Formats are named rather than pattern-based:

| Format | Example (`ru`) | Example (`en`) |
| --- | --- | --- |
| `iso` (default for dates) | 2026-08-28 | 2026-08-28 |
| `short` | 28.08.2026 | 8/28/2026 |
| `long` | 28 августа | August 28 |
| `full` | 28 августа 2026 г. | August 28, 2026 |
| `weekday` | пятница | Friday |
| `day` | 28 | 28 |
| `month` | август | August |
| `year` | 2026 | 2026 |

Named formats map onto `Intl.DateTimeFormat` options, which keeps the feature
dependency-free and locale-correct. Pattern strings such as `d MMMM` were
rejected: they would require either a hand-written formatter or promoting
`date-fns` from a transitive dependency of `react-day-picker` to a direct one,
and they hard-code word order that `Intl` derives from the locale.

Locale comes from a new optional `ui.locale` in `flowmark.yaml`, defaulting to
`en`. Without it, `long` would render differently on different machines from the
same source file, which violates the source-of-truth contract.

An unknown variable, an unparsable expression, an unknown format, or a format
applied to `weekday` or `week` is a **validation error**. A broken template
cannot reach disk from the UI and cannot pass `flowmark validate`.

### Card origin marker

Created cards carry an optional frontmatter field:

```yaml
origin:
  rule_id: rule_piano
  template_id: template_piano
  occurrence: 2026-08-22T08:00:00Z
```

The field is optional, so every existing card stays valid. It is canonical
state, which is what makes duplicate creation impossible even after the
disposable runtime directory is deleted.

This requires fixing `yamlCard`, which currently discards source fields it does
not know. The fix is the `...sourceFields(existing)` spread that the column,
rule, and tag writers already use.

### Rule extensions

```yaml
# rules/rule_piano.yaml
schema_version: 1
id: rule_piano
name: Практика пианино
enabled: true
trigger:
  type: schedule
  every:
    days: 3
    anchor: 2026-08-19
    at: "08:00"
  timezone: Europe/Amsterdam
actions:
  - type: create_card
    template_id: template_piano
    column_id: column_inbox      # optional, overrides the template
created_at: 2026-08-26T09:00:00Z
updated_at: 2026-08-26T09:00:00Z
```

`schedule` triggers accept exactly one of `cron` or `every`. The `every` form
takes `days` or `weeks` (positive integer), an `anchor` calendar date, and an
optional `at` time defaulting to `00:00`.

`every` exists because cron cannot express "every third day": `*/3` in the
day-of-month field restarts at the first of each month, collapsing the interval
to one day at every month boundary. Anchored arithmetic is also computable
backwards, which the missed-occurrence backfill depends on.

Constraints enforced by the validator, deliberately narrow for this iteration:

- `create_card` is valid only under `trigger.type: schedule`. Creating the next
  card when the previous one completes is a natural extension but needs
  different machinery and is out of scope.
- A rule containing `create_card` carries no `conditions`. Conditions describe a
  card, and at creation time there is no card to describe.
- `template_id` must reference an existing template.

## Runtime

### Occurrence computation

A new pure module `src/lib/workspace/schedule.ts` exposes:

```ts
occurrencesBetween(trigger, after: Date, until: Date, timeZone: string): Date[]
```

Cron triggers iterate `new Cron(...).nextRun()` from `after`. `every` triggers
compute arithmetically from the anchor using the existing `calendarDateAtOffset`
helper, so month boundaries and DST shifts are handled by the same code path the
rest of the workspace already trusts.

The function touches no files and knows nothing about rules, which makes month
boundaries, DST transitions, and leap days directly testable, and reduces the
whole backfill problem to one call.

For live scheduling, `every` cannot use `croner`. `startWorkspaceJobs` instead
arms a timer for the next occurrence and re-arms after each firing. The returned
stop function keeps its current contract and clears timers as well as jobs.

### Board-level actions

`runScheduledRule` gains a first phase for board-level actions — `create_card`
and `sort_cards` — executed once per run, before the existing per-card loop for
card-level actions. Cards created in the first phase emit `card.created` into
the derived-event list, so ordinary event rules route the new card onward. That
cascade is the mechanism by which a card created two days early lands in the
right column when its due date arrives.

### Missed occurrences

`.flowmark/jobs/<rule_id>.yaml` holds a single watermark:

```yaml
last_processed: 2026-08-22T08:00:00Z
```

At startup, and whenever the UI asks, each scheduled rule resolves:

```
watermark = jobs.last_processed
          ?? max(origin.occurrence over cards and archive for this rule)
          ?? rule.created_at
pending   = occurrencesBetween(trigger, watermark, now)
```

Three layers keep this honest. The watermark is the fast path. Rebuilding it
from canonical card origins survives deletion of `.flowmark/`. The floor at
`rule.created_at` stops a newly authored rule from backfilling history it never
observed.

An occurrence that arrives while the server is running creates its card
immediately and silently. Only genuinely missed occurrences enter the pending
queue.

Each pending occurrence is presented to the user, who chooses:

- **Repeat** — create the card. Default focus, so Enter accepts.
- **Skip** — do not create it.
- **Repeat the whole series** — apply Repeat to every pending occurrence of that
  rule.
- **Decline the whole series** — apply Skip to every pending occurrence.

Escape defers rather than declines; the queue is presented again next time.

Every decision advances the watermark past that occurrence. Repeat additionally
stamps `origin.occurrence` on the created card, so even a lost watermark cannot
produce a duplicate — the rebuild path sees the card and starts after it.

When a single rule accumulates more than twenty pending occurrences, the queue
collapses into one series-level question showing the count and date range,
rather than twenty consecutive dialogs.

## Interface

### Templates

`TemplatesButton` sits beside `RulesButton` in the board header and follows the
same pattern: a button opening a list modal, and a row opening an editor modal.
The editor reuses `EditableMarkdown`, `TagPicker`, and `ChecklistItemText`
directly. A new `TemplateDuePicker` wraps `DueDatePicker` with a
`none | offset | fixed` mode switch.

Where a card shows comments, a template shows a variables panel: every available
expression with its value resolved for the current moment, so the author sees
what `{{date+2d:long}}` will become without waiting for the rule to fire.

Templates have no comments, no completion state, and no position on the board.

### Missed occurrences

`MissedOccurrencesDialog` presents one question at a time with the four actions
above, keyboard-first, with focus defaulting to Repeat.

### Rule editor

`rule-model.ts`, `rules-ui.ts`, and the `rules-repository` mapping in both
directions gain the `schedule` trigger and the `create_card` action. Without
this the feature is half YAML-only and the Templates button leads nowhere: the
user could author a template but not the rule that uses it.

The client-side `rule-engine.ts` does not execute `create_card`. Card creation
belongs to the server; optimistic client-side creation would fabricate cards
that the server might not agree to.

## Validation

New diagnostics in `validator.ts`:

- Template: non-empty `card.title`; parsable expressions in title, body, and
  checklist entries; existing `column_id` and `tag_ids`; `due.mode` consistent
  with the fields present; `checklist` a list of strings.
- Rule: `create_card` only under a `schedule` trigger; existing `template_id`;
  no `conditions` alongside `create_card`; exactly one of `cron` and `every`;
  valid `days`/`weeks`, `anchor`, and `at`.
- Card: `origin`, when present, is a mapping with a valid `rule_id`,
  `template_id`, and ISO `occurrence`.

Deleting a template referenced by a rule is refused, mirroring the existing
protection for columns and tags in `board-repository.ts`.

## Testing

- Pure units: expression parsing, rendering, arithmetic, and every named format;
  `occurrencesBetween` across month boundaries, DST transitions, and leap days
  for both cron and `every`; due resolution for all three modes.
- Workspace: template and rule diagnostics, including each rejection above;
  `origin` round-trip through `writeWorkspaceBoard`, which is the direct
  regression test for the `yamlCard` fix.
- Runtime: scheduled creation; the `card.created` cascade into event rules;
  idempotency by `origin`; watermark rebuild after `.flowmark/` is deleted; all
  four missed-occurrence decisions; the twenty-occurrence collapse.
- Interface: template editor round-trip, variables panel, missed-occurrence
  dialog keyboard behaviour, and scheduled rules appearing in the rule editor.

## Documentation

`docs/rules.md`, `docs/workspace-format.md`, `AGENTS.md`, the
`FLOWMARK_AGENT_GUIDANCE` string in `initializer.ts`, and the output of
`flowmark schema template` all describe the new surface.

## Out of scope

- `create_card` on non-schedule triggers.
- Pattern-based date formats.
- Variables beyond the table above; no counters, no cross-card references.
- Editing an already-created card's `origin` from the UI.
