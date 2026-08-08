# Global Card Link Resolution Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `flowmark link <card-id>` work outside a Flowmark workspace by resolving one matching live workspace, with explicit ambiguity handling and a `--workspace <path>` override.

**Architecture:** Keep link resolution in the existing CLI command. Preserve current-workspace scoping, use the session registry only when the invocation directory is not a workspace, and strictly validate every selected or inferred workspace before producing the existing custom URL.

**Tech Stack:** TypeScript, Bun, Node test runner, filesystem-backed Flowmark workspaces.

---

### Task 1: Define CLI resolution behavior with failing tests

**Files:**

- Modify: `test/cli-sessions.test.ts`

**Step 1: Write the failing tests**

Add focused tests proving that:

- help advertises `--workspace PATH` and no longer says links are only for the current workspace;
- one live workspace containing the requested active card is inferred outside a workspace;
- multiple matching live workspaces produce an error listing each path and suggesting `cd` or `--workspace`;
- a current workspace scopes lookup even if another live workspace has the same card ID;
- `--workspace <path>` accepts an invocation-directory-relative path and selects only that workspace;
- missing and duplicate workspace flags fail before workspace discovery.

Use the existing `initializeWorkspaceWithCard`, `session`, registry helpers, and injected probes. Avoid mocking validation or URL construction.

**Step 2: Run the focused tests and verify RED**

Run: `bun test test/cli-sessions.test.ts`

Expected: the new tests fail because `linkCard` still requires `cwd` to be a workspace and does not parse `--workspace`.

### Task 2: Implement minimal workspace resolution

**Files:**

- Modify: `src/cli.ts`

**Step 1: Parse the explicit workspace flag**

Accept exactly one `--workspace <path>` after the card ID. Reject duplicate flags and missing values with exit code 2. Resolve relative paths against the invocation directory before canonicalization.

**Step 2: Preserve scoped lookup**

When `--workspace` is present, or when `cwd` contains `flowmark.yaml`, strictly validate that workspace, require the active card, require its live session, and emit the existing formatted URL.

**Step 3: Add live-session inference outside a workspace**

Prune stale sessions, deduplicate their workspace paths, strictly validate each live workspace, and collect workspaces containing the requested non-archived card. Emit the URL for one match, a not-found diagnostic for zero matches, or a sorted path list plus `cd`/`--workspace` guidance for multiple matches.

**Step 4: Run the focused tests and verify GREEN**

Run: `bun test test/cli-sessions.test.ts`

Expected: all CLI session tests pass.

### Task 3: Document and verify the public CLI contract

**Files:**

- Modify: `README.md`
- Modify: `src/cli.ts`

**Step 1: Update user-facing documentation**

Document inference from live sessions, current-workspace precedence, ambiguity handling, and `--workspace <path>`.

**Step 2: Run focused and complete verification**

Run:

```sh
bun test test/cli-sessions.test.ts test/card-links.test.ts
bun run test
bun run typecheck
bun run lint
bun run format:check
bun run build
bun run binary
bun run test:binary
dist/flowmark validate --strict
```

Expected: every command exits successfully, the standalone binary still discovers global sessions, and strict workspace validation passes.

**Step 3: Review the diff**

Run: `git diff --check` and inspect `git diff`.

Expected: only the CLI, its tests, README, and the approved plan documents change.
