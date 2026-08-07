# Exact Card ID Search Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the existing board search find cards by an exact full ID or generated 12-character ID suffix without partial ID matches.

**Architecture:** Add one pure search matcher to `src/lib/board-filters.ts`. It classifies ID-shaped queries before falling back to the existing prose substring search, and `Board.tsx` delegates its search predicate to that helper while retaining the current tag, due, and completion filters.

**Tech Stack:** TypeScript, React, Bun `node:test`.

---

### Task 1: Add exact card ID matching

**Files:**

- Modify: `test/board-toolbar.test.ts`
- Modify: `src/lib/board-filters.ts`
- Modify: `src/components/board/Board.tsx`

**Step 1: Write failing pure matcher tests**

Create a representative `Card` whose ID is `card_gycbfxxzw5au` and whose prose
contains ordinary searchable text plus a different ID-shaped string. Require:

```ts
assert.equal(matchesCardSearch(card, "gycbfxxzw5au"), true);
assert.equal(matchesCardSearch(card, "card_gycbfxxzw5au"), true);
assert.equal(matchesCardSearch(card, "CARD_GYCBFXXZW5AU"), true);
assert.equal(matchesCardSearch(card, "gycbfxxzw5a"), false);
assert.equal(matchesCardSearch(card, "card_gycbfxxzw5a"), false);
assert.equal(matchesCardSearch(card, "zzzzzzzzzzzz"), false);
assert.equal(matchesCardSearch(card, "ordinary title"), true);
```

Also prove that a 12-character ID-shaped query found only in title, description,
checklist, or comments does not match because ID-only mode overrides prose.

**Step 2: Run the focused test and verify RED**

Run: `bun test test/board-toolbar.test.ts`

Expected: FAIL because `matchesCardSearch` is not exported.

**Step 3: Implement the minimal pure matcher**

In `src/lib/board-filters.ts`, normalize the query to lowercase. Return `true`
for an empty query. Treat `^[a-z0-9]{12}$` as a generated suffix and use the
shared `isCardId` helper (`^card_[a-z0-9]+(?:_[a-z0-9]+)*$`) to recognize full
candidate IDs. For either ID-shaped form, compare only the complete normalized
card ID. Otherwise preserve the existing case-insensitive substring search
across title, description, checklist text, and comment bodies.

**Step 4: Run the focused test and verify GREEN**

Run: `bun test test/board-toolbar.test.ts`

Expected: all toolbar/filter tests pass.

**Step 5: Write the failing Board integration assertion**

Require `Board.tsx` to import `matchesCardSearch` from `board-filters` and use
`matchesCardSearch(c, query)` instead of retaining duplicate inline prose
matching.

**Step 6: Run the focused test and verify RED**

Run: `bun test test/board-toolbar.test.ts`

Expected: FAIL because Board still contains inline matching.

**Step 7: Delegate Board search to the helper**

Replace only the search block inside the existing `filterCard` callback. Keep
tag, completed, and due filtering order and behavior unchanged.

**Step 8: Run focused tests and verify GREEN**

Run: `bun test test/board-toolbar.test.ts`

Expected: all tests pass.

**Step 9: Commit the behavior**

```sh
git add src/lib/board-filters.ts src/components/board/Board.tsx test/board-toolbar.test.ts docs/plans/2026-08-07-exact-card-id-search.md
git commit -m "Search cards by exact ID"
```

### Task 2: Verify and integrate

**Step 1: Run the complete repository gate**

Run `bun run format`, `bun run test`, `bun run typecheck`, `bun run lint`,
`bun run format:check`, `bun run build`, `bun run binary`, and
`bun run test:binary`. Run strict example workspace validation and
`git diff --check`.

Expected: every command exits zero.

**Step 2: Review the complete diff**

Compare the implementation against the design and confirm that every changed
production line belongs to search matching only.

**Step 3: Merge and deploy**

Merge the verified feature branch into local `master`, rerun the full tests on
the merged result, update the installed native binary, restart the existing
workspace session, and push `master` to the already confirmed origin.
