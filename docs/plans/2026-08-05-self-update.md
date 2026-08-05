# Flowmark Self-Update Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a safe `flowmark update` command that atomically replaces the running standalone executable with the verified latest stable release.

**Architecture:** A new updater module maps the local platform to an existing release asset, downloads the archive and checksum manifest, verifies SHA-256, extracts only the `flowmark` entry, and atomically replaces the resolved running executable. CLI dispatch receives an injected updater only from the generated standalone entry, so source-mode execution cannot overwrite Bun and all non-update commands stay offline.

**Tech Stack:** Bun, TypeScript, Node filesystem/crypto/child-process APIs, GitHub release assets, Bun `node:test`.

---

### Task 1: Specify release selection and checksum parsing

**Files:**

- Create: `src/lib/self-update.ts`
- Create: `test/self-update.test.ts`

**Step 1: Write failing pure-function tests**

Require the updater module and specify the supported release assets:

```ts
assert.equal(releaseAssetName("darwin", "arm64"), "flowmark-darwin-arm64.tar.gz");
assert.equal(releaseAssetName("darwin", "x64"), "flowmark-darwin-x64.tar.gz");
assert.equal(releaseAssetName("linux", "x64"), "flowmark-linux-x64.tar.gz");
assert.throws(() => releaseAssetName("linux", "arm64"), /not available/i);
assert.throws(() => releaseAssetName("win32", "x64"), /unsupported operating system/i);
```

Specify exact checksum-manifest matching, including GNU binary markers, and
reject missing or malformed entries:

```ts
assert.equal(
  checksumForAsset(`${"a".repeat(64)}  *flowmark-darwin-arm64.tar.gz\n`, asset),
  "a".repeat(64),
);
assert.throws(
  () => checksumForAsset(`${"a".repeat(64)}  another.tar.gz\n`, asset),
  /does not contain/i,
);
```

**Step 2: Run tests and verify red**

Run: `bun test test/self-update.test.ts`

Expected: FAIL because `src/lib/self-update.ts` does not exist.

**Step 3: Implement the minimum pure functions**

Create stable helpers:

```ts
export function releaseAssetName(platform: NodeJS.Platform, architecture: string): string;
export function checksumForAsset(manifest: string, asset: string): string;
```

Only the three archives already produced by `.github/workflows/release.yml` are
valid. Checksum parsing must require a 64-character hexadecimal digest and an
exact filename match.

**Step 4: Run tests and verify green**

Run: `bun test test/self-update.test.ts`

Expected: all release selection and checksum tests pass.

### Task 2: Implement the verified atomic update transaction

**Files:**

- Modify: `src/lib/self-update.ts`
- Modify: `test/self-update.test.ts`

**Step 1: Add failing fixture-based transaction tests**

Build local `.tar.gz` fixtures containing a fake executable and a matching
`SHA256SUMS`. Inject a downloader that copies fixture files by URL basename.
Specify this public API:

```ts
const result = await updateFlowmark({
  executablePath: installedBinary,
  platform: "darwin",
  architecture: "arm64",
  download: copyFixtureDownload,
});

assert.equal(await readFile(installedBinary, "utf8"), "new executable\n");
assert.equal(result.asset, "flowmark-darwin-arm64.tar.gz");
```

Add separate tests proving checksum mismatch, a malformed archive, and an
archive without a top-level `flowmark` entry all return errors while the
installed executable remains byte-identical.

**Step 2: Run tests and verify red**

Run: `bun test test/self-update.test.ts`

Expected: FAIL because `updateFlowmark` is absent.

**Step 3: Implement download, verification, extraction, and replacement**

Implement:

```ts
export interface UpdateFlowmarkOptions {
  executablePath: string;
  platform?: NodeJS.Platform;
  architecture?: string;
  repository?: string;
  download?: (url: string, destination: string) => Promise<void>;
}

export async function updateFlowmark(options: UpdateFlowmarkOptions): Promise<{
  asset: string;
  executablePath: string;
}>;
```

The transaction must:

1. create a disposable system temporary directory;
2. download the archive and `SHA256SUMS` from
   `https://github.com/carlosray/flowmark/releases/latest/download`;
3. hash the archive as a stream and compare it before extraction;
4. run `tar -xzf <archive> -C <directory> flowmark` so unrelated or
   path-traversing entries are never extracted;
5. verify the extracted entry is a regular file;
6. copy to `.<basename>.<pid>.<uuid>.tmp` beside the installed executable,
   apply `0755`, flush the file, atomically rename over the executable, and
   flush the containing directory;
7. remove the sibling temporary file on any failed rename and always remove
   the disposable download directory.

The default downloader uses `fetch`, rejects non-2xx responses with the URL and
status, writes the response body to a new file, and flushes it. No update state
is written to a workspace.

**Step 4: Run focused tests and verify green**

Run: `bun test test/self-update.test.ts`

Expected: successful replacement passes and every failure case preserves the
old executable.

### Task 3: Add workspace-independent CLI dispatch

**Files:**

- Modify: `src/cli.ts`
- Modify: `test/workspace.test.ts`

**Step 1: Write failing CLI tests**

Extend help assertions to require `flowmark update`. Add a command test with a
non-workspace cwd and an injected updater:

```ts
const result = await runCli(["update"], {
  cwd: emptyDirectory,
  runUpdate: async () => ({
    asset: "flowmark-darwin-arm64.tar.gz",
    executablePath: "/custom/bin/flowmark",
  }),
  write: (message) => output.push(message),
});
assert.equal(result.exitCode, 0);
assert.match(output.join("\n"), /updated flowmark/i);
assert.match(output.join("\n"), /restart.*sessions/i);
```

Add a source-mode test without `runUpdate`; it must return non-zero, mention
source checkout rebuilding, and perform no workspace validation.

**Step 2: Run tests and verify red**

Run: `bun test test/workspace.test.ts`

Expected: FAIL because `update` is unknown and absent from help.

**Step 3: Implement minimal CLI wiring**

Add to `CliOptions`:

```ts
runUpdate?: () => Promise<{ asset: string; executablePath: string }>;
```

Recognize and dispatch `update` before workspace canonicalization. Without the
adapter, return an actionable source-mode error. Catch updater errors, print
their message, and return exit code 1. On success, print the executable path
and tell the user to restart active sessions.

**Step 4: Run tests and verify green**

Run: `bun test test/workspace.test.ts test/self-update.test.ts`

Expected: updater and workspace-independent CLI tests pass.

### Task 4: Wire the standalone executable and document updates

**Files:**

- Modify: `scripts/build-binary.ts`
- Modify: `test/binary-build.test.ts`
- Modify: `README.md`
- Modify: `test/public-release.test.ts`

**Step 1: Write failing release-wiring tests**

Require generated release-entry source to import `realpath` and
`updateFlowmark`, resolve `process.execPath`, and pass a `runUpdate` adapter to
`runCli`. Require README installation documentation to contain the normal
subsequent update command:

```text
flowmark update
```

**Step 2: Run tests and verify red**

Run: `bun test test/binary-build.test.ts test/public-release.test.ts`

Expected: FAIL because the generated entry and README do not expose updates.

**Step 3: Implement binary adapter and docs**

In the generated entry, import `realpath` from `node:fs/promises` and
`updateFlowmark` from `src/lib/self-update.ts`, then pass:

```ts
runUpdate: async () =>
  updateFlowmark({ executablePath: await realpath(process.execPath) }),
```

to `runCli`. Document `flowmark update` after first-install instructions and
state explicitly that it is the only normal Flowmark command that needs
network access.

**Step 4: Run tests and verify green**

Run: `bun test test/binary-build.test.ts test/public-release.test.ts`

Expected: binary wiring and documentation tests pass.

### Task 5: Verify, review, commit, and push

**Files:** All files above.

**Step 1: Run focused updater tests**

Run:

```sh
bun test test/self-update.test.ts test/workspace.test.ts test/binary-build.test.ts test/public-release.test.ts
```

Expected: all focused tests pass.

**Step 2: Run the complete release gate**

Run:

```sh
bun run test
bun run typecheck
bun run lint
bun run format:check
bun run build
bun run binary
bun run test:binary
```

From `example/`, run:

```sh
bun run ../src/cli.ts validate --strict
```

Expected: zero test failures, clean static checks, successful production and
binary builds, successful standalone smoke test, and zero strict workspace
warnings.

**Step 3: Review and commit**

Run `git diff --check`, inspect the full diff, apply `git config-carlosray`, and
commit the implementation with a logically scoped message.

**Step 4: Push**

Push `master` to `origin` without force. Verify local `HEAD` and
`origin/master` resolve to the same commit and that the working tree is clean.
