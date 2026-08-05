# Workspace path footer design

## Goal

Replace the footer's local-first storage copy and interactive Storage popover
with the absolute path of the workspace served by the running Flowmark process.

## Chosen approach

`Board` already subscribes to `useBoardSync()`, whose `filePath` is populated by
the server from `FLOWMARK_WORKSPACE_ROOT` or `process.cwd()`. Render that value
directly as non-interactive, truncated monospace text in the footer, with the
full path in a native `title` tooltip and an ellipsis while the initial read is
still loading.

This avoids a second server function and removes the redundant `StorageInfo`
component. Using the rules sync path instead would couple a workspace-wide UI
detail to one resource type and would provide no additional information.

## UI contract

- The footer keeps its existing keyboard shortcut hints.
- The right side contains only the absolute workspace root path.
- The path is plain text: no button, icon, popover, or storage explanation.
- Long paths truncate visually without changing the available full path.
- Before hydration provides the path, the footer displays an ellipsis.

## Tests

A focused source-level UI contract test will require the footer to render
`sync.filePath`, reject the removed marketing copy and `StorageInfo`, and ensure
the path is not wrapped in a button. The normal project test, typecheck, lint,
format, build, binary, binary smoke, and workspace validation gates run before
handoff.
