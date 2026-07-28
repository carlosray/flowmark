<p align="center">
  <img src="src/assets/flowmark-icon.png" width="112" alt="Flowmark icon">
</p>

<h1 align="center">Flowmark</h1>

<p align="center">
  A local-first Kanban board where Markdown and YAML are the database.
</p>

Flowmark turns any directory into a calm, keyboard-friendly task workspace. It
runs on your computer, serves the board only on loopback, and writes every
meaningful change to a human-readable file. There is no account, cloud service,
telemetry, or hidden database.

![Flowmark board](docs/assets/flowmark-board.png)

## Why Flowmark?

- **Your files are the product.** Cards and comments are Markdown; columns,
  tags, rules, checklists, and templates are YAML.
- **Local and offline by default.** The UI binds to `127.0.0.1` and makes no
  runtime network requests.
- **Friendly to Git and agents.** One resource per file, immutable IDs,
  deterministic validation, machine-readable schemas, and reviewable diffs.
- **Useful automation without hidden state.** Rules can route, date, tag,
  complete, archive, and sort cards. Startup reconciliation catches missed
  date transitions.
- **A focused board.** Drag and drop, Markdown descriptions/comments/checklists,
  tag filtering, due dates, keyboard saving, and eight workspace themes.
- **One executable.** The release binary contains the CLI, server, UI, and
  background scheduler.

## Install

Download the binary for your platform from the
[latest release](../../releases/latest):

| Platform            | Asset                          |
| ------------------- | ------------------------------ |
| Apple Silicon macOS | `flowmark-darwin-arm64.tar.gz` |
| Intel macOS         | `flowmark-darwin-x64.tar.gz`   |
| x86-64 Linux        | `flowmark-linux-x64.tar.gz`    |

Download `SHA256SUMS` beside the archive and verify it with
`sha256sum -c SHA256SUMS` on Linux or `shasum -a 256 -c SHA256SUMS` on macOS.
Then extract the archive and place its `flowmark` executable on your `PATH`:

```sh
tar -xzf flowmark-darwin-arm64.tar.gz # choose the archive for your platform
install -m 0755 flowmark ~/.local/bin/flowmark
flowmark --help
```

macOS may attach a quarantine attribute to unsigned downloads. If Finder
blocks a binary you trust, remove that attribute explicitly:

```sh
xattr -d com.apple.quarantine ~/.local/bin/flowmark
```

To run from source instead, install [Bun](https://bun.sh/) and use:

```sh
bun install
bun link
```

Flowmark does not require network access after installation.

## Quick start

```sh
mkdir my-tasks
cd my-tasks
flowmark init
flowmark
```

Open the printed `http://127.0.0.1:…/` address. `flowmark init` is idempotent:
running it again verifies the existing workspace without replacing your files.

Run Flowmark in the background:

```sh
flowmark --daemon
flowmark list
flowmark stop <session-id>
```

Sessions are discoverable from every directory through
`~/.flowmark/sessions.json`. The registry contains only process metadata and
can be rebuilt; task content never lives there.

## Files are the database

```text
my-tasks/
├── flowmark.yaml
├── cards/          # Markdown with YAML frontmatter
├── columns/        # YAML
├── tags/           # YAML
├── rules/          # YAML
├── comments/       # Markdown with YAML frontmatter
├── checklists/     # YAML
├── templates/      # YAML
├── archive/        # Archived source resources
└── .flowmark/      # Disposable runtime data; ignored by Git
```

Flowmark validates the complete graph before the UI or scheduler starts. Bad
fields, duplicate IDs, filename mismatches, unsupported versions, and broken
references produce stable error codes with a file, field, explanation, and
suggested fix.

```sh
flowmark validate --strict
flowmark schema card --format json
flowmark schema rule
flowmark schema --all
flowmark repair
```

`repair` only rebuilds disposable `.flowmark/` state. It never changes
authoritative task files. Flowmark does not silently migrate or rewrite a
workspace on startup.

## Rules

Columns store structure, not behavior. Automations are explicit files in
`rules/`:

```yaml
schema_version: 1
id: rule_today_due_date
name: Set due date when moved to Today
enabled: true
trigger:
  type: card_entered_column
  column_id: column_today
actions:
  - type: set_due_date
    mode: end_of_day
created_at: 2026-07-20T09:00:00Z
updated_at: 2026-07-20T09:00:00Z
```

Rules run as bounded, deterministic transactions. Unchanged actions are
no-ops, cascades are loop-protected, and derived changes are written back to
the same card files. See [Rules](docs/rules.md) for the complete model.

## Documentation

- [Workspace format](docs/workspace-format.md)
- [Rule engine](docs/rules.md)
- [Architecture](docs/architecture.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

The `example/` directory is a complete workspace that can be opened with:

```sh
cd example
bun run ../src/cli.ts
```

## Development

```sh
bun install
bun run dev
bun run test
bun run typecheck
bun run lint
bun run format:check
bun run build
bun run binary
bun run test:binary
```

The binary smoke test copies the executable to a temporary directory and
verifies initialization, strict validation, daemon startup, rendered assets,
global session listing, and shutdown.

## Status

Flowmark is an early public release. The workspace format is deliberately
strict; preserve compatibility when extending it, and use explicit schema
versions for future changes. Bug reports and focused contributions are
welcome.

## License

[MIT](LICENSE)
