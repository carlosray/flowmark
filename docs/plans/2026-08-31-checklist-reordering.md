# Checklist Reordering Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users reorder checklist rows in the open-card modal with a hover-revealed drag handle and persist the new order to the canonical YAML checklist.

**Architecture:** Add a focused `BoardStore.reorderChecklistItem` mutation that reorders the existing checklist array by immutable item IDs. Render the modal checklist as a nested vertical dnd-kit sortable list whose handle is the only activator; the existing board repository will atomically serialize array order back to item `position` values.

**Tech Stack:** TypeScript, React 19, TanStack Start, `@dnd-kit/core`, `@dnd-kit/sortable`, Tailwind CSS v4, Bun test runner, YAML filesystem persistence.

---

### Task 1: Store checklist reorder mutation

**Files:**
- Modify: `test/store.test.ts`
- Modify: `src/lib/store.ts`

**Step 1: Write the failing test**

Add a test with three checklist items that calls:

```ts
store.reorderChecklistItem("card_test", "item_third", "item_first");
await store.flushPendingSave();
```

Assert that the saved checklist IDs are `item_third`, `item_first`, `item_second`, that each item's text/completion values are unchanged, and that persistence ran once.

**Step 2: Run the focused test to verify RED**

Run: `bun test test/store.test.ts --test-name-pattern "reorders checklist items"`

Expected: FAIL because `reorderChecklistItem` does not exist.

**Step 3: Implement the minimal mutation**

In the checklist section of `BoardStore`, find the source and target indices, return for a missing card/item or unchanged index, clone the checklist, splice the active item out, splice it into the target index, and call `updateCard` once:

```ts
reorderChecklistItem(cardId: string, activeItemId: string, overItemId: string) {
  const card = this.state.cards[cardId];
  if (!card) return;
  const oldIndex = card.checklist.findIndex((item) => item.id === activeItemId);
  const newIndex = card.checklist.findIndex((item) => item.id === overItemId);
  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;
  const checklist = [...card.checklist];
  const [item] = checklist.splice(oldIndex, 1);
  checklist.splice(newIndex, 0, item);
  this.updateCard(cardId, { checklist });
}
```

**Step 4: Run the focused test to verify GREEN**

Run: `bun test test/store.test.ts --test-name-pattern "reorders checklist items"`

Expected: PASS.

**Step 5: Commit**

```bash
git add test/store.test.ts src/lib/store.ts
git commit -m "Add checklist reorder mutation"
```

### Task 2: Canonical YAML order round-trip

**Files:**
- Modify: `test/workspace.test.ts`

**Step 1: Write the failing repository test**

Extend the fixture checklist to at least two items inside the test, reorder the projected `card.checklist` array, call `writeWorkspaceBoard`, reload the board, and assert the new ID order. Read `checklists/checklist_review.yaml` and assert that the reordered items receive increasing `position` values in the same order. Finish with strict validation:

```ts
assert.deepEqual(
  reloaded.cards.card_review?.checklist.map((item) => item.id),
  ["item_second", "item_first"],
);
assert.deepEqual((await validateWorkspace(root, { strict: true })).errors, []);
```

**Step 2: Run the focused test**

Run: `bun test test/workspace.test.ts --test-name-pattern "persists reordered checklist items"`

Expected: PASS with the current repository implementation; this characterizes the existing persistence contract. If it fails, make only the minimal repository correction needed to serialize array order into positions.

**Step 3: Commit**

```bash
git add test/workspace.test.ts src/lib/workspace/board-repository.ts
git commit -m "Test checklist order persistence"
```

### Task 3: Sortable checklist rows in the card modal

**Files:**
- Modify: `test/checklist-markdown.test.tsx`
- Modify: `src/components/board/CardModal.tsx`

**Step 1: Write failing UI contract tests**

Assert the modal source contains a nested `DndContext`, a vertical `SortableContext`, a checklist row using `useSortable`, handle-bound `listeners` and `attributes`, an accessible label containing `Reorder checklist item`, `CSS.Transform.toString(transform)`, the dnd-kit `transition`, and a `DragOverlay` for the active row. Assert the row—not the full list—owns the hover group that reveals the handle.

**Step 2: Run the focused UI tests to verify RED**

Run: `bun test test/checklist-markdown.test.tsx`

Expected: FAIL because the modal checklist is not sortable.

**Step 3: Add the nested drag context**

Import pointer, touch, and keyboard sensors from `@dnd-kit/core`; import `SortableContext`, `useSortable`, `verticalListSortingStrategy`, and `sortableKeyboardCoordinates` from `@dnd-kit/sortable`; import `CSS` and `GripVertical`.

Keep active item ID in the checklist section. On drag start, store the checklist item ID. On drag cancel, clear it. On drag end, clear it and, when both IDs are valid and different, call:

```ts
store.reorderChecklistItem(card.id, String(active.id), String(over.id));
```

Use stable checklist item IDs as the sortable identifiers.

**Step 4: Extract the sortable row**

Create a file-local `SortableChecklistRow` that:

- calls `useSortable({ id: item.id })`;
- applies `transform`, `transition`, and a reduced opacity while dragging;
- keeps the existing checkbox, editable Markdown text, and delete button behavior;
- renders an overflow-hidden handle slot with `w-0 opacity-0` by default and `group-hover:w-5 group-hover:opacity-100` plus equivalent `group-focus-within` classes;
- binds activator ref, attributes, and listeners only to a `GripVertical` button;
- labels the button `Reorder checklist item: <text or empty item>`.

Render the lifted row in `DragOverlay` with the existing surface, border, radius, and shadow tokens, but without live checkbox/edit/delete actions.

**Step 5: Run focused tests to verify GREEN**

Run: `bun test test/checklist-markdown.test.tsx test/store.test.ts test/workspace.test.ts`

Expected: all focused tests PASS.

**Step 6: Commit**

```bash
git add test/checklist-markdown.test.tsx src/components/board/CardModal.tsx
git commit -m "Add draggable checklist rows"
```

### Task 4: Visual and regression verification

**Files:**
- Modify only if verification exposes a task-related issue.

**Step 1: Run complete static and unit checks**

Run, in order:

```bash
bun run test
bun run typecheck
bun run lint
bun run format:check
bun run build
```

Expected: all commands exit 0 without new warnings.

**Step 2: Run standalone binary verification**

```bash
bun run binary
bun run test:binary
```

Expected: binary builds and the isolated smoke suite passes.

**Step 3: Validate a workspace strictly**

Run `bun run flowmark validate --strict` from a valid fixture or initialized temporary workspace, following the CLI's existing test setup.

Expected: validation succeeds with zero warnings.

**Step 4: Inspect the interaction locally**

Start Flowmark on an isolated fixture workspace. Verify that only the hovered/focused row reveals its handle, the row content shifts smoothly, drag begins only from the handle, the full row follows the pointer, neighboring rows animate, keyboard reordering works, and reopening the card preserves the order.

**Step 5: Final diff checks**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and only task-related changes.

**Step 6: Commit any verification-only correction**

If Task 4 required a source correction, commit only that correction with its regression test. Otherwise do not create an empty commit.
