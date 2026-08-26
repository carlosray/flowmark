# Rules

Flowmark keeps board policy in explicit `rules/*.yaml` resources. Rules are
generic: they reference immutable column and tag IDs, never special display
names.

Use `flowmark schema rule` for the exact contract supported by your installed
version.

## Model

Each enabled or disabled rule has one trigger, zero or more conditions, and one
or more ordered actions:

```yaml
schema_version: 1
id: rule_completed_to_done
name: Move completed cards to Done
enabled: true
trigger:
  type: card_completed
actions:
  - type: move_card
    column_id: column_done
created_at: 2026-07-20T09:00:00Z
updated_at: 2026-07-20T09:00:00Z
```

Disabled rules must still be valid. Broken references and unknown rule types
are errors.

## Triggers

- `card_created`
- `card_entered_column` with `column_id`
- `card_completed`
- `card_uncompleted`
- `due_date_reached`
- `due_state_changed`
- `schedule` with either `cron` or `every`, and an optional `timezone`

A scheduled trigger takes exactly one of the two forms:

```yaml
trigger:
  type: schedule
  cron: "0 8 * * 2,4" # Tuesdays and Thursdays at 08:00
```

```yaml
trigger:
  type: schedule
  every:
    days: 3 # or weeks
    anchor: 2026-08-19 # the interval counts from here
    at: "08:00" # optional, defaults to midnight
```

`every` exists because cron cannot express "every third day": `*/3` in the
day-of-month field restarts on the first of each month, which collapses the
interval at every month boundary. Anchored intervals keep a constant spacing and
can be computed backwards, which is what makes missed runs recoverable.

Scheduled rules inherit the workspace timezone when none is specified.
`due_state_changed` is also reconciled on startup and local-date rollover, so
date-driven routing does not depend on a browser tab remaining open.

## Conditions

- `column`, using `column_id` or `operator: in|not_in` with `column_ids`
- `tag` with `tag_id`
- `completed` with a boolean `value`
- `due_state` with `none`, `overdue`, `today`, `tomorrow`, or `future`
- `created_age_days`
- `completed_age_days`

Age conditions accept a numeric `value`; use
`operator: greater_than_or_equal` when writing the comparison explicitly.

## Actions

- `move_card`
- `set_due_date` with `mode: end_of_day|offset`
- `clear_due_date`
- `add_tag`
- `remove_tag`
- `mark_completed`
- `mark_uncompleted`
- `archive_card`
- `sort_cards`
- `create_card` with `template_id` and an optional `column_id`

The supported stable sort is:

```yaml
- type: sort_cards
  scope: all_columns
  by: due_at
  direction: ascending
  nulls: last
```

Equal dates preserve their previous relative order.

## Creating cards on a schedule

`create_card` instantiates a template. It is the one action that does not act on
an existing card, so it is restricted: it is valid only under a `schedule`
trigger, and its rule carries no conditions, because at creation time there is
no card to test.

```yaml
schema_version: 1
id: rule_piano
name: Piano practice
enabled: true
trigger:
  type: schedule
  every:
    days: 3
    anchor: 2026-08-19
    at: "08:00"
actions:
  - type: create_card
    template_id: template_piano
created_at: 2026-08-26T09:00:00Z
updated_at: 2026-08-26T09:00:00Z
```

The new card raises `card_created`, so ordinary event rules route it onward.
That is how a card created two days early still reaches the right column when
its due date arrives.

### Template expressions

A template's title, body, and checklist entries accept `{{...}}` expressions,
resolved against the moment the rule fires, in the rule's timezone:

```
{{ variable [±N(d|w|m)] [:format] }}
```

Every variable is a projection of one underlying date; arithmetic shifts that
date and the variable reports its own aspect of the result.

| Variable   | Renders                                                | Takes a format |
| ---------- | ------------------------------------------------------ | -------------- |
| `date`     | the date the rule fires                                | yes            |
| `due_date` | the due date the card receives, empty when it has none | yes            |
| `weekday`  | the day-of-week name                                   | no             |
| `week`     | the ISO week number                                    | no             |

Formats are `iso` (the default), `short`, `long`, `full`, `weekday`, `day`,
`month`, and `year`, rendered in `ui.locale`. So `{{date+2d:long}}` on a
Wednesday in August reads "August 28", and `{{weekday+2d}}` reads "Friday".

### Missed runs

A rule that fires while Flowmark is running creates its card immediately. Runs
that fall while the machine is off are not lost and not applied silently: on the
next start Flowmark works out exactly which occurrences were missed and asks
about each one, offering to create it, skip it, or answer for the whole series
at once. More than twenty missed runs of one rule collapse into a single
question naming the range.

How far each rule has been processed is kept in `.flowmark/jobs/`, which stays
disposable. If it is deleted, the mark is rebuilt from the `origin` markers on
the cards themselves, so no card is ever created twice; only previously declined
runs are asked about again.

## Date-driven example

An undated card moved into Planned can receive a date ten days ahead:

```yaml
schema_version: 1
id: rule_plan_undated_card
name: Date undated cards moved to Planned
enabled: true
trigger:
  type: card_entered_column
  column_id: column_planned
conditions:
  - type: due_state
    value: none
actions:
  - type: set_due_date
    mode: offset
    offset_days: 10
created_at: 2026-07-20T09:00:00Z
updated_at: 2026-07-20T09:00:00Z
```

Routing cards whose dates are cleared:

```yaml
schema_version: 1
id: rule_undated_to_plan
name: Move undated dated-workflow cards to To Plan
enabled: true
trigger:
  type: due_state_changed
conditions:
  - type: completed
    value: false
  - type: due_state
    value: none
  - type: column
    operator: in
    column_ids: [column_today, column_tomorrow, column_planned]
actions:
  - type: move_card
    column_id: column_to_plan
created_at: 2026-07-20T09:00:00Z
updated_at: 2026-07-20T09:00:00Z
```

## Execution semantics

Event rules run in a bounded transaction queue. Actions emit derived events,
which may activate another rule. The engine:

- applies rules in deterministic source order;
- treats identical due dates, tags, completion values, and target columns as
  no-ops;
- runs sorting after other actions settle;
- detects repeated states and enforces a hard transition bound;
- persists one settled board state.

The UI briefly retains the direct manipulation state before showing rule-driven
movement and highlights derived due-date changes. Source files remain the final
authority.

The visual editor preserves manually authored rules it cannot represent. Use
YAML and `flowmark schema rule` for the complete model.
