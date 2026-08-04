# Editable Markdown titles design

## Goal

Render Markdown links in card titles everywhere they are displayed and give
titles, descriptions, and existing comments one consistent preview-to-edit
interaction.

## Interaction contract

- Rendered Markdown is the default for a non-empty title, description, or
  existing comment.
- Clicking rendered text or pressing `Enter` starts editing.
- Clicking a link opens it safely in a new tab and never starts editing, opens
  the card, or begins a drag.
- Blurring an editor saves and returns to rendered mode.
- `Escape` cancels the current edit and restores the last persisted value.
- `Enter` saves a single-line title.
- `Command+Enter` or `Ctrl+Enter` saves multiline descriptions and comments.
- An empty description opens directly in edit mode. The new-comment composer
  remains an editor until the comment is created.

## Components

`MarkdownContent` will continue to render full Markdown and will export an
inline variant for titles. Both variants share the same safe link component,
including click and pointer-down isolation.

A small controlled `EditableMarkdown` component will own preview/edit mode and
the current edit draft. It accepts single-line or multiline editor behavior,
normalization, styling, and callbacks. Title and description changes continue
to flow into `OpenCardModal` state so closing the dialog cannot lose an active
edit. Existing comments use the same component and a new `store.updateComment`
operation.

The board card and drag overlay use the inline renderer. The open-card title,
description, and each existing comment use `EditableMarkdown`.

## Persistence and safety

Title and description saves use the existing `updateCard` path. Comment edits
replace only the matching comment body through `updateComment`; the existing
board repository then atomically rewrites and validates its authoritative
Markdown file. No workspace schema changes are needed.

## Tests

Tests cover inline Markdown links and unsafe protocols, isolated link pointer
events, common save/cancel resolution, single-line and multiline shortcuts,
all three modal integrations, comment-store persistence, card-title rendering,
and authoritative comment-file updates. The full test, typecheck, lint, format,
build, binary, and strict workspace validation gates run before push.
