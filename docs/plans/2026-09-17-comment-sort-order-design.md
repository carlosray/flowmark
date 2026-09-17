# Comment Sort Order Design

## Goal

Let users switch every card modal between newest-first and oldest-first comment display. The
workspace-wide preference persists across restarts and defaults to newest-first.

## Persistence

Store `ui.comment_sort_order` in `.flowmark/runtime.yaml` as `descending` or `ascending`.
Runtime preferences are rebuildable, ignored by Git, and already hold local UI state. A missing,
malformed, or unsupported value resolves to `descending`.

Writing the preference must preserve unrelated runtime fields and YAML comments. It uses the
existing atomic runtime preference write path.

## UI and data flow

The index route reads the preference when loading the workspace and initializes a small client
store. The card modal reads that shared value, so changing it in any card immediately affects every
subsequently opened card.

Next to `Comments (N)`, render a compact button whose icon and accessible label describe the
current order (`Newest first` or `Oldest first`). Clicking it changes the shared value immediately
and persists it through a server function. If persistence fails, restore the previous value so the
UI does not claim an unsaved preference.

Only a copied array is sorted for rendering. Canonical comment arrays and Markdown resources keep
their existing order. Compare valid `createdAt` timestamps first and use immutable comment IDs as a
stable tie-breaker.

## Testing

- Runtime preference tests cover the descending default, valid values, invalid values, atomic
  writes, and preservation of unrelated YAML content.
- Pure sorting tests cover both directions and deterministic ties without mutating the input.
- UI contract tests cover the accessible control next to the Comments heading and its connection
  to the shared preference.
- Finish with the complete project verification suite required by `AGENTS.md`.
