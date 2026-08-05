# Workspace Path Footer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show the running Flowmark workspace's absolute root path as plain text in the board footer.

**Architecture:** Reuse the existing `useBoardSync()` snapshot already consumed by `Board`; its `filePath` comes from the server-resolved workspace root. Remove the now-unused interactive storage component and protect the footer contract with a focused source-level test.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, Bun `node:test`.

---

### Task 1: Specify the footer contract

**Files:**

- Create: `test/board-footer.test.ts`
- Test: `src/components/board/Board.tsx`

**Step 1: Write the failing test**

Read `Board.tsx` and assert that it renders `sync.filePath`, provides an
ellipsis fallback, and no longer contains `StorageInfo`, `Local-first`, or
`Markdown files as source of truth`. Assert the footer path is rendered in a
`code` element rather than a button.

**Step 2: Run the test and verify it fails**

Run: `bun test test/board-footer.test.ts`

Expected: FAIL because the current footer still imports and renders
`StorageInfo` and the local-first marketing copy.

### Task 2: Render the absolute workspace path

**Files:**

- Modify: `src/components/board/Board.tsx:27-34,398-414`
- Delete: `src/components/board/StorageInfo.tsx`
- Test: `test/board-footer.test.ts`

**Step 1: Implement the minimum footer change**

Remove the `StorageInfo` import and component. Replace the right-side footer
group with a truncated monospace `code` element whose content and `title` use:

```tsx
sync.filePath ?? "…";
```

Keep the keyboard shortcut hints unchanged.

**Step 2: Run the focused test and verify it passes**

Run: `bun test test/board-footer.test.ts`

Expected: PASS.

**Step 3: Run focused static checks**

Run: `bun run typecheck && bun run lint && bun run format:check`

Expected: all commands exit 0 with no unused import or formatting diagnostics.

### Task 3: Verify and commit

**Files:** All files above.

**Step 1: Run the complete project gates**

Run `bun run test`, `bun run typecheck`, `bun run lint`, `bun run format:check`,
`bun run build`, `bun run binary`, `bun run test:binary`, and from `example/`
run the newly built `flowmark validate --strict`.

Expected: every command exits 0.

**Step 2: Inspect and commit**

Run `git diff --check` and inspect `git status --short`. Commit the design,
plan, test, footer change, and component deletion as one logically scoped
change.
