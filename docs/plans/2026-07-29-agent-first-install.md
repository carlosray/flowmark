# Agent-first Installer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a verified one-line installer and make agent-operated task management Flowmark's primary README story.

**Architecture:** A dependency-free POSIX shell installer maps `uname` output to existing release asset names, downloads only the chosen archive plus `SHA256SUMS`, verifies it, and installs atomically enough for a single executable. README and release automation expose the installer, while integration tests replace `curl` and `uname` with deterministic local fixtures and execute the real script.

**Tech Stack:** POSIX `sh`, `curl`, `tar`, `sha256sum`/`shasum`, Bun's `node:test`, GitHub Actions.

---

### Task 1: Specify public installer behavior

**Files:**

- Create: `test/install-script.test.ts`
- Modify: `test/public-release.test.ts`

**Step 1: Write the failing tests**

Add installer integration tests that create a fake release archive and checksum
manifest, inject fake `curl` and `uname` commands through `PATH`, execute
`sh install.sh`, and assert:

- Darwin ARM64 selects `flowmark-darwin-arm64.tar.gz`;
- `FLOWMARK_INSTALL_DIR` receives an executable named `flowmark`;
- `FLOWMARK_VERSION=v0.1.0` uses `/releases/download/v0.1.0/`;
- an unsupported OS exits non-zero with an actionable message;
- a mismatched checksum exits non-zero without installing a binary.

Extend the public-release test to require `install.sh`, the raw GitHub
`curl | sh` command, agent-oriented prompts, checksum verification, and
`install.sh` in packaged release archives.

**Step 2: Run tests to verify they fail**

Run:

```sh
bun test test/install-script.test.ts test/public-release.test.ts
```

Expected: failure because `install.sh` and the new README content do not exist.

### Task 2: Implement the installer

**Files:**

- Create: `install.sh`

**Step 1: Add minimal POSIX implementation**

Implement OS/architecture mapping, temporary-directory cleanup, release URL
selection, `curl` downloads, exact archive checksum comparison, extraction,
installation into `${FLOWMARK_INSTALL_DIR:-$HOME/.local/bin}`, and PATH
guidance. Do not use `sudo`, package managers, or new dependencies.

**Step 2: Run focused tests**

Run:

```sh
bun test test/install-script.test.ts
```

Expected: all installer integration tests pass.

### Task 3: Lead the README with agents

**Files:**

- Modify: `README.md`

**Step 1: Add agent-first positioning**

Rewrite the opening so the primary promise is a Kanban workspace both humans
and coding agents can operate safely. Add examples for initialization,
planning, triage, and rules. Explain `AGENTS.md`, live schemas, strict
validation, and reviewable Git diffs.

**Step 2: Add the one-line installation path**

Place the raw GitHub `curl | sh` command before manual archive instructions.
Document the default destination, PATH setup, `FLOWMARK_INSTALL_DIR`, and
`FLOWMARK_VERSION`.

**Step 3: Run public documentation tests**

Run:

```sh
bun test test/public-release.test.ts
```

Expected: all public-release assertions pass.

### Task 4: Package and verify the installer

**Files:**

- Modify: `.github/workflows/release.yml`

**Step 1: Include installer in release archives**

Copy `install.sh` into the package directory and include it in each tarball.

**Step 2: Run all release gates**

Run:

```sh
bun run format
bun run test
bun run typecheck
bun run lint
bun run format:check
bun run build
bun run binary
bun run test:binary
```

Expected: every command exits zero; the full test suite reports zero failures,
and the standalone binary smoke test prints a loopback URL.

### Task 5: Commit the implementation

**Files:**

- Add all files listed above.

**Step 1: Review the diff**

Run `git diff --check` and inspect `git status --short`.

**Step 2: Commit**

```sh
git add install.sh README.md .github/workflows/release.yml \
  test/install-script.test.ts test/public-release.test.ts docs/plans
git commit -m "Add agent-first installation"
```
