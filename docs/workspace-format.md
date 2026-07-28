# Workspace format

Flowmark schema version 1 is a directory of explicit Markdown and YAML
resources. Paths are relative to the workspace root, so moving the whole
directory does not break references.

```text
workspace/
├── flowmark.yaml
├── cards/
├── columns/
├── tags/
├── rules/
├── comments/
├── checklists/
├── templates/
├── archive/
│   ├── cards/
│   ├── comments/
│   └── checklists/
└── .flowmark/
```

Only `flowmark.yaml` and the source component directories are authoritative.
`.flowmark/` is disposable.

## Inspect the exact schema

The CLI is the canonical, version-matched schema reference:

```sh
flowmark schema
flowmark schema workspace
flowmark schema card --format json
flowmark schema --all --format yaml
```

The output uses JSON Schema Draft 2020-12 plus `x-flowmark-file` metadata for
the expected filename and file type. Run `flowmark validate --strict` after
manual or agent edits.

## Identity and references

- Every ID is immutable, lowercase, URL-safe, type-prefixed, and unique within
  its resource type.
- A filename must equal its resource ID: `cards/card_example.md`,
  `tags/tag_work.yaml`, and so on.
- References always use IDs. Display names and titles may change.
- File order has no meaning. Numeric `position` values and
  `ui.column_order` define business order.

## Root file

`flowmark.yaml` identifies the workspace, source paths, the initial structural
column, and UI preferences:

```yaml
schema_version: 1
workspace:
  id: workspace_personal
  name: Personal Tasks
  created_at: 2026-07-20T12:00:00Z
  timezone: Europe/Amsterdam
paths:
  cards: cards
  columns: columns
  tags: tags
  rules: rules
  comments: comments
  checklists: checklists
  templates: templates
  archive: archive
  system: .flowmark
defaults:
  initial_column_id: column_inbox
ui:
  column_order: [column_inbox]
  theme: flow-neutral
```

Completion, due-date, movement, sorting, and archival policy do not belong in
the root or column files. Express them with rules.

## Cards and comments

Cards and comments are Markdown with YAML frontmatter. The body is rendered as
Markdown and is preserved independently of structured fields.

```markdown
---
schema_version: 1
id: card_review_gateway
title: Review gateway document
column_id: column_inbox
position: 1024
completed: false
completed_at: null
due_at: null
tag_ids: []
checklist_ids: []
comment_ids: []
created_at: 2026-07-20T09:30:00Z
updated_at: 2026-07-20T09:30:00Z
archived_at: null
---

Review the current behavior and record the decision.
```

Comments and checklists point to their owning card, and the card points back.
Both directions must agree.

## Archive behavior

Archived cards remain source files. Flowmark moves the card to
`archive/cards/`, preserves its ID and history, sets `archived_at`, sets
`column_id: null`, and stores its last active column as `previous_column_id`.
Owned comments and checklists remain preserved in the archive.

## Compatibility and writes

Flowmark rejects unsupported future versions and does not silently migrate or
rewrite a workspace at startup. Source writes are atomic: a sibling temporary
file is flushed and renamed over the old file, the containing directory is
flushed, and affected resources are revalidated. Multi-resource transactions
roll back every touched file when final validation fails.

Unknown fields are warnings by default and errors in strict mode. A validation
error includes a stable code, file, field, safe value, explanation, and
suggested fix.
