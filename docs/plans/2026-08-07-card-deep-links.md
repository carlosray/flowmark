# Card Deep Links Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add agent-friendly card links that resolve a live workspace dynamically and reuse an existing Safari tab through an installed macOS URL handler.

**Architecture:** A pure card-link module owns custom URL creation, parsing, and session/card resolution. The board synchronizes an optional card ID with the root route search state, while a small macOS integration module installs and executes a user-local `flowmark://` handler without changing canonical workspace data.

**Tech Stack:** TypeScript, Bun CLI and standalone binary, TanStack Router, React 19, macOS AppleScript/LaunchServices, Bun `node:test`.

---

### Task 1: Specify card URL creation and live-session resolution

**Files:**

- Create: `test/card-links.test.ts`
- Create: `src/lib/card-links.ts`
- Modify: `src/cli.ts`
- Modify: `test/cli-sessions.test.ts`

**Step 1: Write failing pure-function tests**

Require `buildFlowmarkCardUrl(workspacePath, cardId)` to percent-encode the
absolute workspace path, require `parseFlowmarkCardUrl(url)` to reject unknown
schemes/actions, relative paths, and invalid card IDs, and require
`buildSessionCardUrl(session.url, cardId)` to produce `/?card=<id>`.

**Step 2: Run red tests**

Run `bun test test/card-links.test.ts`.
Expected: fail because `src/lib/card-links.ts` does not exist.

**Step 3: Implement the pure URL contract**

Add strict helpers with this public shape:

```ts
export function buildFlowmarkCardUrl(workspacePath: string, cardId: string): string;
export function parseFlowmarkCardUrl(value: string): { workspacePath: string; cardId: string };
export function buildSessionCardUrl(sessionUrl: string, cardId: string): string;
```

Use `path.isAbsolute`, the existing lowercase type-prefixed ID contract, and
the platform `URL` implementation. Do not read the filesystem in these helpers.

**Step 4: Run green tests**

Run `bun test test/card-links.test.ts`.
Expected: all URL-contract tests pass.

**Step 5: Write failing CLI tests**

In `test/cli-sessions.test.ts`, create an initialized workspace with a card and
a registered session. Require `flowmark link <id>` and `--format markdown` to
emit the custom URL, and cover missing card, invalid format, missing session,
and stale session outcomes through the existing injected probe.

**Step 6: Run CLI tests red**

Run `bun test test/cli-sessions.test.ts`.
Expected: fail with `Unknown command: link`.

**Step 7: Add the minimal `link` command**

Extend `HELP_TEXT`, the command allowlist, and `CliOptions` only as needed. Reuse
`canonicalizeWorkspacePath`, full strict workspace validation, the session
registry, and injected session probing. Confirm `cards/<id>.md` is an active
validated card before printing either the raw or Markdown custom link.

**Step 8: Run CLI tests green**

Run `bun test test/card-links.test.ts test/cli-sessions.test.ts`.
Expected: all link and session tests pass.

### Task 2: Open a card modal from root-route search state

**Files:**

- Create: `test/card-deep-link.test.ts`
- Create: `src/lib/card-deep-link.ts`
- Modify: `src/routes/index.tsx`
- Modify: `src/components/board/Board.tsx`

**Step 1: Write failing state-contract tests**

Test a pure search parser that accepts only valid `card_` IDs and a helper that
returns the requested ID only when it exists in the hydrated board. Add source
integration assertions that the root route validates `card`, passes it into
`Board`, and that board open/close actions report URL state changes.

**Step 2: Run red tests**

Run `bun test test/card-deep-link.test.ts`.
Expected: fail because the search helpers and board contract do not exist.

**Step 3: Implement search-state synchronization**

Validate the root route search object without adding a dependency. Pass the
requested card ID and an `onOpenCardIdChange` callback to `Board`. Initialize
the modal from the deep link after hydration, update the search parameter for
normal card opens, and clear it on close or invalid/missing active cards. Keep
draft-card behavior unchanged.

**Step 4: Run green tests**

Run `bun test test/card-deep-link.test.ts test/card-modal.test.ts`.
Expected: all deep-link and existing modal tests pass.

### Task 3: Install and execute the macOS Safari link handler

**Files:**

- Create: `src/lib/macos-card-link-handler.ts`
- Create: `test/macos-card-link-handler.test.ts`
- Modify: `src/cli.ts`
- Modify: `scripts/build-binary.ts`
- Modify: `test/cli-sessions.test.ts`

**Step 1: Write failing installer and Safari tests**

Specify pure AppleScript source generation and injected command execution.
Require installation to target a supplied user Applications directory, embed
the absolute Flowmark executable, register `flowmark` as a URL scheme, preserve
unrelated files, and reject non-macOS platforms. Require open handling to probe
the exact workspace session, construct the HTTP card URL, and invoke
`osascript` with URL values as arguments rather than script interpolation.

**Step 2: Run red tests**

Run `bun test test/macos-card-link-handler.test.ts test/cli-sessions.test.ts`.
Expected: fail because installer/open-handler APIs and CLI commands are absent.

**Step 3: Implement explicit handler installation**

Add `flowmark links install` and internal `flowmark __open-url <url>` commands.
Build the handler under `~/Applications/Flowmark Card Links.app` with
`osacompile`, add the required `CFBundleURLTypes` metadata, and register it with
LaunchServices. Use dependency injection for filesystem/process effects so
tests run offline and without GUI automation.

**Step 4: Implement Safari reuse**

Run AppleScript that finds a Safari tab whose URL starts with the selected
session URL, changes that tab to the HTTP card URL, selects its window/tab, and
activates Safari. If no matching tab exists, open the URL in Safari. Report
missing/stale sessions and malformed links without launching a browser.

**Step 5: Wire the standalone binary**

Pass the actual executable path from the generated release entry so installed
handlers invoke the standalone binary rather than Bun or the source checkout.

**Step 6: Run green tests**

Run `bun test test/macos-card-link-handler.test.ts test/cli-sessions.test.ts test/build-binary.test.ts`.
Expected: all macOS integration, CLI, and generated-entry tests pass.

### Task 4: Add opt-in card-link guidance without overwriting custom rules

**Files:**

- Modify: `src/lib/workspace/initializer.ts`
- Modify: `test/workspace.test.ts`
- Modify: `scripts/smoke-binary.ts`
- Modify: `README.md`

**Step 1: Write failing generated-guidance tests**

Require newly initialized `AGENTS.md` to contain a bounded
`flowmark-card-links: ask` block that defaults to source paths, asks once, and
documents `always`/`never` plus `flowmark link ... --format markdown`. Preserve
the existing test proving `flowmark init` never rewrites a pre-existing
`AGENTS.md`.

**Step 2: Run red tests**

Run `bun test test/workspace.test.ts`.
Expected: fail because generated guidance has no card-link preference block.

**Step 3: Extend generated guidance and documentation**

Add only the bounded block to `FLOWMARK_AGENT_GUIDANCE`. Document link creation,
the one-time macOS handler installation, the Safari Automation prompt, and the
portable source-path fallback in `README.md`. Extend binary smoke assertions to
ensure release guidance exposes the feature.

**Step 4: Run green tests**

Run `bun test test/workspace.test.ts`.
Expected: initialization and custom-guidance preservation tests pass.

### Task 5: Verify, build, install, and migrate live workspaces

**Files:**

- Modify outside repository after build: `~/Applications/Flowmark Card Links.app`
- Modify outside repository: each live session workspace `AGENTS.md`

**Step 1: Run focused and full repository gates**

Run `bun run format`, `bun run test`, `bun run typecheck`, `bun run lint`,
`bun run format:check`, `bun run build`, `bun run binary`, and
`bun run test:binary`. Run `flowmark validate --strict` for the repository
workspace if applicable.

**Step 2: Inspect the final repository diff**

Run `git diff --check`, `git status --short`, and inspect every changed file.
Expected: only deep-link, handler, guidance, documentation, and test changes.

**Step 3: Install the local handler**

Run the built standalone executable with `links install`. Confirm LaunchServices
registration and note the expected first-use Safari Automation permission.

**Step 4: Discover and update live workspaces**

Run `flowmark list` to prune stale sessions. For every live workspace, append
the bounded card-link block only if absent. Set the current user-approved
workspace to `always`; never replace or reformat its existing `AGENTS.md`.

**Step 5: Validate migrated workspaces**

Run `flowmark validate --strict` in each modified workspace and compare the
pre/post `AGENTS.md` content outside the appended block.

**Step 6: Perform a real Safari smoke test**

Generate a link for an existing card, invoke the custom URL, and verify the
already open Flowmark Safari tab becomes active with that card modal open. If
macOS requests Automation permission, report that user action explicitly and
rerun after approval.

**Step 7: Commit repository changes**

Commit the verified implementation as a logically scoped change without adding
the user-local app bundle or workspace-specific `AGENTS.md` files to the repo.
