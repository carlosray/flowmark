# Agent-first installation and positioning design

## Goal

Make Flowmark installable with one auditable shell command and present its
strongest differentiator first: humans and coding agents manage the same
validated Markdown and YAML task workspace.

## Installer

Add a POSIX `install.sh` at the repository root. It will:

- detect macOS or Linux and ARM64 or x86-64;
- download the matching archive from the latest GitHub release;
- download `SHA256SUMS` and verify the selected archive before extraction;
- install `flowmark` into `${FLOWMARK_INSTALL_DIR:-$HOME/.local/bin}` without
  `sudo`;
- support a pinned `FLOWMARK_VERSION`, such as `v0.1.0`;
- clean its temporary directory on success, interruption, or failure;
- fail with a direct message for unsupported systems, missing tools, download
  failures, and checksum failures.

The public one-liner will be:

```sh
curl -fsSL https://raw.githubusercontent.com/carlosray/flowmark/master/install.sh | sh
```

Manual archive installation remains documented for users who prefer to inspect
each step. The release archive will include `install.sh` alongside the binary,
license, and README.

## Agent-first README

The opening copy will describe Flowmark as an agent-native Kanban workspace,
then explain why the filesystem contract makes that safe and practical:

- agents edit ordinary Markdown and YAML instead of driving a browser;
- `flowmark init` creates workspace structure and `AGENTS.md` guidance;
- `flowmark schema --all` exposes the current contracts;
- `flowmark validate --strict` checks every file and reference before the UI
  starts;
- Git shows every task and rule change as a reviewable diff.

Concrete prompts will cover initializing a project board, turning a plan into
cards and checklists, routine task triage, and declarative rule creation.

## Verification

Tests will execute the real installer with fake local release downloads. They
will cover platform selection, checksum verification, custom installation
directories, pinned versions, unsupported platforms, and corrupted archives.
Public-release tests will require the one-liner, agent-first examples, and
installer packaging in the release workflow.
