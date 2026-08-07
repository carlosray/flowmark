# Terminal Card Link Format Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make OSC 8 terminal hyperlinks the deterministic default for `flowmark link` while preserving explicit raw and Markdown output.

**Architecture:** Keep URL construction in `src/lib/card-links.ts` and add one pure formatter there so terminal control bytes are tested without filesystem or session setup. The CLI validates the three supported format names, defaults to `terminal`, and delegates formatting after its existing workspace/card/session checks. Generated guidance and documentation use the default command rather than freezing a presentation format.

**Tech Stack:** TypeScript, Bun CLI, OSC 8 terminal hyperlinks, Bun `node:test`.

---

### Task 1: Add the terminal formatter and CLI default

**Files:**

- Modify: `test/card-links.test.ts`
- Modify: `test/cli-sessions.test.ts`
- Modify: `src/lib/card-links.ts`
- Modify: `src/cli.ts`

**Step 1: Write the failing pure formatter test**

Add a test requiring the terminal output to equal these exact bytes:

```ts
const url = "flowmark://open?workspace=%2Ftmp%2Ftasks&card=card_example";
assert.equal(
  formatFlowmarkCardLink(url, "terminal"),
  `\u001b]8;;${url}\u001b\\Open in Flowmark\u001b]8;;\u001b\\`,
);
assert.equal(formatFlowmarkCardLink(url, "raw"), url);
assert.equal(formatFlowmarkCardLink(url, "markdown"), `[Open in Flowmark](${url})`);
```

**Step 2: Run the pure test and verify RED**

Run: `bun test test/card-links.test.ts`

Expected: FAIL because `formatFlowmarkCardLink` is not exported.

**Step 3: Implement the minimal pure formatter**

Export the three-name `CardLinkFormat` union, `CARD_LINK_FORMATS`, and
`formatFlowmarkCardLink(url, format)` from `src/lib/card-links.ts`. Keep the
visible label fixed at `Open in Flowmark`; do not add TTY detection.

**Step 4: Run the pure test and verify GREEN**

Run: `bun test test/card-links.test.ts`

Expected: all card-link tests pass.

**Step 5: Write failing CLI tests**

Update the live-workspace test so the command without `--format` expects the
exact OSC 8 string. Add explicit `--format terminal`, retain explicit raw and
Markdown assertions, and require the invalid-format diagnostic to list all
three names.

**Step 6: Run the CLI test and verify RED**

Run: `bun test test/cli-sessions.test.ts`

Expected: FAIL because the CLI still defaults to raw and rejects `terminal`.

**Step 7: Implement the CLI behavior**

Default `flagValue(args, "--format")` to `terminal`, validate against the
shared supported-format list, call `formatFlowmarkCardLink`, and update command
usage/help to `terminal|raw|markdown (default: terminal)`.

**Step 8: Run focused tests and verify GREEN**

Run: `bun test test/card-links.test.ts test/cli-sessions.test.ts`

Expected: all link and CLI tests pass.

**Step 9: Commit the behavioral change**

```sh
git add src/lib/card-links.ts src/cli.ts test/card-links.test.ts test/cli-sessions.test.ts
git commit -m "Default card links to terminal hyperlinks"
```

### Task 2: Update agent guidance, docs, and binary coverage

**Files:**

- Modify: `test/workspace.test.ts`
- Modify: `scripts/smoke-binary.ts`
- Modify: `src/lib/workspace/initializer.ts`
- Modify: `README.md`

**Step 1: Write failing guidance tests**

Require generated guidance to use `flowmark link <card_id>` without
`--format markdown`. Extend binary smoke checks to require documentation of the
terminal default and explicit raw/Markdown alternatives.

**Step 2: Run tests and verify RED**

Run: `bun test test/workspace.test.ts test/binary-build.test.ts`

Expected: FAIL because generated guidance still freezes Markdown output.

**Step 3: Update generated guidance and documentation**

Tell agents in `always` mode to run the default command and include its output.
Document Ghostty/macOS `Cmd+click`, OSC 8, deterministic redirected output,
`--format raw` for scripts, and `--format markdown` for Markdown renderers.

**Step 4: Run focused tests and verify GREEN**

Run: `bun test test/workspace.test.ts test/binary-build.test.ts`

Expected: all guidance and binary source tests pass.

**Step 5: Commit guidance and documentation**

```sh
git add src/lib/workspace/initializer.ts test/workspace.test.ts scripts/smoke-binary.ts README.md
git commit -m "Document terminal card links for agents"
```

### Task 3: Verify, install, and migrate the live workspace

**Files:**

- Modify outside repository: `~/.local/bin/flowmark-native`
- Modify outside repository: the live workspace's `AGENTS.md`

**Step 1: Run the repository gate**

Run `bun run format`, `bun run test`, `bun run typecheck`, `bun run lint`,
`bun run format:check`, `bun run build`, `bun run binary`, and
`bun run test:binary`. Run `git diff --check` and inspect the full diff.

Expected: every command exits zero and the full suite has no failures.

**Step 2: Update the installed binary**

Stop only the registered live-workspace session, copy
the verified `dist/flowmark` to the existing `flowmark-native` target, reinstall
the handler if its executable path changed, and restart the workspace daemon.

Expected: the daemon uses `http://127.0.0.1:3000/` when available.

**Step 3: Migrate only the bounded guidance block**

In the live workspace's `AGENTS.md`, replace only the
`flowmark link <card_id> --format markdown` text inside the existing
`flowmark-card-links: always` block with `flowmark link <card_id>`. Preserve all
custom instructions outside the block exactly.

**Step 4: Validate and smoke test**

Run `flowmark validate --strict` in the live workspace. Run default, raw, and
Markdown link commands for `card_jnuuoqv59qjk`; verify that default output
contains OSC 8 bytes and that invoking the raw URL reuses FlowMark.

**Step 5: Finish the branch**

Merge the verified feature branch into `master`, rerun `bun run test` on merged
master, clean up the worktree, and request explicit confirmation before pushing
`master` to `git@github.com:carlosray/flowmark.git`.
