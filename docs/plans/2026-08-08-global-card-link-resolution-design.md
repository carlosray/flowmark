# Global Card Link Resolution Design

## Goal

Allow `flowmark link <card-id>` to resolve a card when invoked outside a
Flowmark workspace, while preserving predictable workspace scoping and making
ambiguous card IDs explicit.

## Resolution contract

`flowmark link <card-id> --workspace <path>` resolves the supplied path relative
to the invocation directory when necessary, validates that workspace strictly,
requires a live registered session for it, and searches only that workspace.

Without `--workspace`, the command first checks the invocation directory. If it
is a Flowmark workspace, existing behavior remains unchanged: the command
searches only that workspace.

When the invocation directory is not a Flowmark workspace, the command prunes
stale sessions and inspects the strictly valid workspace behind each remaining
session. Archived cards are not candidates. If exactly one live workspace has
the active card ID, the command emits that workspace's custom card URL. If no
workspace matches, it reports that the card was not found in any running
workspace. If multiple workspaces match, it lists their paths and asks the user
to either change into the intended workspace or pass `--workspace <path>`.

## Error handling

The workspace flag may be supplied only once and must have a value. An explicit
or current workspace retains the existing validation, missing-card, archived-card,
and missing-session diagnostics. Global discovery never searches arbitrary
filesystem locations; the rebuildable live-session registry remains the only
discovery source.

## Testing

CLI tests cover help text, relative and absolute explicit workspace paths,
current-workspace precedence, one inferred live workspace, no matches, multiple
matches, archived cards, stale-session pruning, and malformed or duplicate
workspace flags. Existing link-format and custom URL behavior remains unchanged.
