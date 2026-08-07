# Terminal card link format design

## Goal

Make `flowmark link <card-id>` directly clickable in terminals such as Ghostty
without removing the existing raw and Markdown formats.

## CLI contract

The default format and explicit `--format terminal` output an OSC 8 hyperlink
whose visible label is `Open in Flowmark` and whose destination is the existing
port-independent `flowmark://` URL.

The other formats remain explicit and stable:

- `--format raw` prints only the `flowmark://` URL for scripts and macOS `open`.
- `--format markdown` prints `[Open in Flowmark](flowmark://...)` for Markdown
  renderers.

Terminal output remains the default even when stdout is redirected. Callers
that need escape-free output must request `raw` or `markdown`; this keeps the
CLI deterministic instead of changing behavior based on TTY detection.

## Agent guidance and compatibility

Fresh `AGENTS.md` guidance tells agents in `always` mode to run the default
`flowmark link <card-id>` command and include its output alongside the card
source path. Existing workspaces receive only the same bounded-block update;
custom guidance remains byte-for-byte untouched.

Help text and README document all three formats and the terminal default. The
custom URL, live-session lookup, browser handler, and workspace format do not
change.

## Verification

Tests assert the exact OSC 8 bytes, the explicit terminal alias, unchanged raw
and Markdown output, invalid-format diagnostics, generated guidance, and binary
smoke coverage. Final verification uses the full project gate, a rebuilt native
binary, strict workspace validation, and a real Ghostty-compatible link output.
