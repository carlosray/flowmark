# Editable Markdown Titles Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Render safe Markdown links in card titles and make titles, descriptions, and comments use one preview-to-edit interaction.

**Architecture:** Extend the shared Markdown renderer with a block-free inline mode, then add a controlled `EditableMarkdown` component for consistent keyboard and pointer behavior. Existing board persistence remains canonical: titles/descriptions use `updateCard`, while a small `updateComment` store operation updates the matching authoritative comment Markdown file.

**Tech Stack:** React 19, React Markdown, TypeScript, Tailwind CSS, Bun `node:test`, filesystem workspace repository.

---

### Task 1: Specify shared inline and editable Markdown behavior

**Files:**

- Create: `test/editable-markdown.test.tsx`
- Modify: `test/description-markdown.test.tsx`

**Step 1: Write failing tests**

Import `MarkdownInline`, `EditableMarkdown`, and pure edit-resolution helpers.
Assert safe inline links, no paragraph wrapper, pointer/click isolation in the
shared anchor, cancel restoration, normalized saves, title `Enter`, multiline
`Command/Ctrl+Enter`, and rendered preview accessibility.

**Step 2: Verify red**

Run `bun test test/editable-markdown.test.tsx test/description-markdown.test.tsx`.
Expected: fail because the inline renderer and editable component do not exist.

### Task 2: Implement shared rendering and editing

**Files:**

- Modify: `src/components/board/MarkdownContent.tsx`
- Create: `src/components/board/EditableMarkdown.tsx`

**Step 1: Implement the minimum shared renderer**

Factor the safe anchor into one component. Stop click and pointer-down
propagation. Export `MarkdownInline` with block elements unwrapped so titles do
not create paragraph, heading, or list layout.

**Step 2: Implement `EditableMarkdown`**

Support controlled draft notifications, preview click/keyboard activation,
single/multiline editors, blur save, Escape cancel, title Enter save, multiline
Command/Ctrl+Enter save, placeholders, normalization, and autofocus.

**Step 3: Verify green**

Run `bun test test/editable-markdown.test.tsx test/description-markdown.test.tsx`.
Expected: all shared Markdown tests pass.

### Task 3: Apply the interaction to card titles and modal content

**Files:**

- Modify: `src/components/board/CardItem.tsx`
- Modify: `src/components/board/CardModal.tsx`
- Modify: `src/components/board/Board.tsx`
- Modify: `test/card-modal.test.ts`
- Create or modify: `test/card-title-markdown.test.tsx`

**Step 1: Write failing integration tests**

Require inline rendering in board cards and drag overlays. Require
`EditableMarkdown` for the modal title, description, and existing comment body,
with links excluded from edit activation.

**Step 2: Verify red**

Run `bun test test/card-title-markdown.test.tsx test/card-modal.test.ts`.
Expected: fail on plain-text titles and the old textarea/preview implementations.

**Step 3: Replace the UI paths**

Use `MarkdownInline` in `CardItem` and `DragOverlay`. Use `EditableMarkdown` in
the modal while keeping `OpenCardModal` title/description draft state connected
to close-time flushing. Preserve existing completed styling and empty
description behavior.

**Step 4: Verify green**

Run `bun test test/card-title-markdown.test.tsx test/card-modal.test.ts`.
Expected: all title/modal interaction tests pass.

### Task 4: Persist edits to existing comments

**Files:**

- Modify: `src/lib/store.ts`
- Modify: `test/store.test.ts`
- Modify: `test/workspace.test.ts`

**Step 1: Write failing persistence tests**

Test that `updateComment(cardId, commentId, body)` changes only the matching
comment and persists it. Add a workspace test proving the matching
`comments/comment_*.md` body changes while strict validation remains clean.

**Step 2: Verify red**

Run `bun test test/store.test.ts test/workspace.test.ts`.
Expected: fail because `updateComment` is absent.

**Step 3: Implement minimal store operation**

Map the target card's comments, replace only the matching body, and call the
existing `updateCard` persistence path. Wire modal comment saves to it.

**Step 4: Verify green**

Run `bun test test/store.test.ts test/workspace.test.ts`.
Expected: comment edit and workspace validation tests pass.

### Task 5: Complete verification, commit, and push

**Files:** All files above.

**Step 1: Run release gates**

Run `bun run format`, `bun run test`, `bun run typecheck`, `bun run lint`,
`bun run format:check`, `bun run build`, `bun run binary`,
`bun run test:binary`, and strict validation in `example/`.

**Step 2: Inspect and commit**

Run `git diff --check`, inspect `git status --short`, and commit the logically
scoped implementation.

**Step 3: Push**

Push `master` to `origin` without force and verify `refs/heads/master` points to
the local commit.
