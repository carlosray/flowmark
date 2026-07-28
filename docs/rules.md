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
- `schedule` with `cron` and optional `timezone`

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

The supported stable sort is:

```yaml
- type: sort_cards
  scope: all_columns
  by: due_at
  direction: ascending
  nulls: last
```

Equal dates preserve their previous relative order.

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
