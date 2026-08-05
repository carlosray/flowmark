# Flowmark self-update design

## Goal

Add `flowmark update` so an installed standalone binary can safely replace
itself with the latest stable GitHub release. Every other Flowmark command must
remain local and offline by default.

## Chosen approach

Flowmark will implement a native updater rather than downloading and executing
`install.sh`. This avoids executing a remote shell script, removes a runtime
dependency on `curl`, and lets the CLI protect the currently installed binary
until the release archive has been fully verified.

The alternatives were invoking `install.sh`, which is smaller but executes
remote shell code, and shipping a separate updater helper, which adds packaging
and lifecycle complexity without improving the supported Unix replacement
flow enough to justify it.

## CLI contract

- `flowmark update` works from any directory and never requires or validates a
  workspace.
- It downloads the latest stable release for the current supported operating
  system and architecture.
- It updates the real path of the currently running standalone executable, so
  custom installation directories continue to work.
- A source invocation such as `bun run src/cli.ts update` refuses to update and
  explains that source checkouts should use Git and rebuild the binary.
- Successful output confirms the update and tells the user to restart active
  Flowmark sessions before expecting them to use the new executable.
- The command does not query GitHub merely to compare versions. Explicitly
  running it safely reinstalls the latest release.

## Update transaction

1. Map the runtime platform and architecture to the existing release archive
   name.
2. Download the archive and `SHA256SUMS` from the latest GitHub release into a
   disposable temporary directory.
3. Find the exact archive entry in `SHA256SUMS` and calculate the archive's
   SHA-256 digest locally.
4. Abort without touching the installed executable if the download, checksum,
   archive, platform, or extraction is invalid.
5. Extract the standalone `flowmark` executable.
6. Copy it to a uniquely named sibling of the current executable, apply mode
   `0755`, flush it, and atomically rename it over the installed executable.
7. Remove temporary files. A failure before the final rename leaves the old
   executable byte-identical.

The latest-release URLs are fixed to the public `carlosray/flowmark` GitHub
repository. Redirects to GitHub's release object storage are permitted by the
ordinary download client. No updater state is stored in a workspace or under
`.flowmark/`.

## Architecture

A new updater module owns platform mapping, checksum parsing, download,
extraction, and atomic replacement. Its external operations are injected at a
small boundary so tests use local fixture archives and never call the network.

`runCli` receives an optional update adapter. The generated standalone binary
entry supplies an adapter bound to its resolved `process.execPath`; source CLI
execution does not, making it impossible for the command to overwrite Bun.
Update dispatch happens before workspace resolution, matching `list`, `stop`,
and `schema`.

The existing POSIX installer remains supported for first installation and
manual recovery. README installation instructions gain `flowmark update` as
the normal subsequent update path.

## Error handling

Errors are concise and actionable: unsupported platform, failed download,
missing checksum entry, checksum mismatch, malformed archive, missing
executable, or insufficient permission. All failures return non-zero. No error
path may replace or truncate the current executable.

## Tests

Tests will cover:

- help text and command dispatch outside a workspace;
- source-mode refusal without calling a downloader;
- supported and unsupported platform mapping;
- exact checksum parsing;
- successful replacement from a local release fixture;
- checksum mismatch preserving the installed executable;
- malformed archives and missing executable entries preserving the installed
  executable;
- generated binary wiring to the current executable;
- README documentation;
- the full Flowmark test, typecheck, lint, formatting, build, binary, binary
  smoke, and strict example validation gates.
