# Comment Sort Order Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a workspace-wide, persisted comment sort toggle that defaults to newest-first.

**Architecture:** Persist `ui.comment_sort_order` in `.flowmark/runtime.yaml`, expose it through a
validated server function and a small shared client store, and render a sorted copy of each card's
comments. Keep canonical comment resources untouched and roll back optimistic UI state if saving
fails.

**Tech Stack:** TypeScript, React 19, TanStack Start server functions, YAML, Bun test runner,
Tailwind CSS v4, Lucide icons.

---

### Task 1: Runtime preference contract

**Files:**

- Modify: `test/runtime-preferences.test.ts`
- Modify: `src/lib/workspace/runtime-preferences.ts`

**Step 1: Write the failing tests**

Add tests asserting that `readCommentSortOrder(root)` defaults to `descending`, accepts both valid
values, rejects unsupported YAML values by falling back to the default, and that
`writeCommentSortOrder(root, order)` preserves unrelated runtime preferences and comments.

**Step 2: Run the focused test and verify RED**

Run: `bun test test/runtime-preferences.test.ts`

Expected: FAIL because the new read/write functions do not exist.

**Step 3: Implement the minimal persistence functions**

Export:

```ts
export type CommentSortOrder = "descending" | "ascending";
export const DEFAULT_COMMENT_SORT_ORDER: CommentSortOrder = "descending";
export async function readCommentSortOrder(root: string): Promise<CommentSortOrder>;
export async function writeCommentSortOrder(root: string, order: CommentSortOrder): Promise<void>;
```

Reuse shared helpers for reading and atomically updating `.flowmark/runtime.yaml`; preserve its
existing contents and validate writes before mutation.

**Step 4: Run the focused test and verify GREEN**

Run: `bun test test/runtime-preferences.test.ts`

Expected: PASS.

### Task 2: Shared preference and sorting behavior

**Files:**

- Create: `test/comment-sort.test.ts`
- Create: `src/lib/comment-sort.ts`
- Create: `src/lib/comment-sort.functions.ts`
- Modify: `src/routes/index.tsx`

**Step 1: Write failing behavior tests**

Cover descending and ascending timestamp order, ID tie-breaking, input immutability, default shared
state, successful persistence, and rollback after a failed save.

**Step 2: Run the focused test and verify RED**

Run: `bun test test/comment-sort.test.ts`

Expected: FAIL because the module does not exist.

**Step 3: Implement minimal shared behavior**

Create a pure `sortComments(comments, order)` helper and a tiny external store compatible with
`useSyncExternalStore`. Add validated GET/POST server functions backed by the runtime preference,
and initialize the store from the index route loader value.

**Step 4: Run the focused test and verify GREEN**

Run: `bun test test/comment-sort.test.ts`

Expected: PASS.

### Task 3: Card modal control

**Files:**

- Modify: `test/card-modal.test.ts`
- Modify: `src/components/board/CardModal.tsx`

**Step 1: Write the failing UI contract test**

Assert that the modal reads the shared order, maps over `sortComments(card.comments, order)`, and
renders an accessible button in `SectionHeader.action` with current-order text and a directional
icon.

**Step 2: Run the focused test and verify RED**

Run: `bun test test/card-modal.test.ts`

Expected: FAIL because the toggle is absent.

**Step 3: Implement the compact toggle**

Use existing button/token styles and Lucide arrow icons. Clicking toggles the shared order and
persists it. Do not reorder `card.comments` or write card/comment resources.

**Step 4: Run focused tests and verify GREEN**

Run: `bun test test/card-modal.test.ts test/comment-sort.test.ts test/runtime-preferences.test.ts`

Expected: PASS.

### Task 4: Full verification

Before full verification, add a focused card-modal test proving that the shared new-comment form is
rendered before the list for `descending` and after it for `ascending`. Extract the form into a
small local render helper or component so there is only one submission implementation.

**Files:**

- Verify only

**Step 1: Run required checks**

Run, independently:

```bash
bun run test
bun run typecheck
bun run lint
bun run format:check
bun run build
bun run binary
bun run test:binary
bun run flowmark validate
git diff --check
```

Expected: every command exits zero and workspace validation succeeds.

**Step 2: Review the final diff**

Confirm every changed production line implements persistence, shared state, sorting, or the UI
control; confirm no canonical workspace schema or comment resource format changed.
