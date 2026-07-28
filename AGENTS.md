# Flowmark project guidance

## Product and storage contract

- Flowmark is a local-first Kanban task manager. Keep interactions responsive, accessible, and keyboard-friendly.
- The filesystem is the database. `flowmark.yaml`, `cards/`, `columns/`, `tags/`, `rules/`, `comments/`, `checklists/`, `templates/`, and `archive/` are the only authoritative state.
- Markdown and YAML are the source of truth. Never introduce SQLite, browser storage, a hidden cache, or a cloud service as canonical storage.
- `.flowmark/` contains only rebuildable caches, indexes, scheduler state, locks, and runtime preferences. It is ignored by Git and must be safe to delete.
- Resource IDs are immutable, lowercase, URL-safe IDs with a type prefix. Filenames match IDs, and all references use IDs—not display names or paths.
- Columns are structural only: identity, name, order, color, and timestamps. Completion, due-date, transition, and archival policy belongs exclusively in `rules/`.
- Completed cards set `completed_at`; open cards use `completed_at: null`. Age-based automation must use this timestamp rather than infer completion from `updated_at`.
- Preserve the filesystem-first architecture. Support only the current workspace format; reject unsupported formats instead of silently rewriting or discarding user data.
- Archived cards live under `archive/cards/`, retain their ID/history/tags/due date, set `archived_at`, set `column_id: null`, and retain `previous_column_id`.
- Keep source changes atomic: write a flushed sibling temporary file, rename it, validate affected resources, then rebuild derived state.

## Application conventions

- The application is TanStack Start + React with file routes in `src/routes/`. Do not hand-edit generated `src/routeTree.gen.ts`.
- Filesystem access belongs in server functions and `src/lib/workspace/`. The client board store may keep UI-only collapsed-column state in `localStorage`, but must never cache canonical cards or rules there.
- `src/lib/workspace/validator.ts` owns full-workspace validation and stable diagnostics. `flowmark validate` is read-only; `serve` validates first; `init` creates missing workspace scaffolding; `repair` changes only `.flowmark/`.
- `flowmark schema <component>` publishes the current machine-readable contract for one source type; `flowmark schema --all` publishes every contract. Keep the catalog and validator behavior in sync, and direct workspace-editing agents to query it rather than freeze field lists in generated guidance.
- `src/lib/workspace/rule-runner.ts` executes scheduled canonical rules locally. Jobs start only after full validation and stop with the local server.
- The board UI uses `src/lib/workspace/board-repository.ts` to project validated components to the UI and write user edits back as canonical resources. Preserve Markdown bodies and non-UI resource fields.
- `src/lib/workspace/file-transaction.ts` owns durable atomic creation, replacement, directory flushing, and rollback for multi-file source changes. Use it instead of ad hoc file writes.
- Keep board components small and composable under `src/components/board/`. Reuse existing primitives in `src/components/ui/`; add a primitive only when the product needs it.
- Styling uses Tailwind CSS v4, custom OKLCH tokens, and `ds-*` utilities in `src/styles.css`. Follow the existing visual system.
- The workspace theme is `ui.theme` in `flowmark.yaml`; Flow Neutral is the fallback. Keep theme IDs in `src/lib/themes.ts`, never add a System theme, and never persist the theme in browser storage.

## Engineering practice

- Default to local, offline work. Do not browse, download dependencies, call external APIs, or contact network services unless the user explicitly requests it.
- Prefer simple, maintainable, incremental changes. Avoid unnecessary abstractions and new dependencies without a written justification.
- Follow existing TypeScript, formatting, and import-alias style. Add tests before behavioral changes and cover validation, persistence, and initialization paths.
- Keep commits logically scoped and preserve backward compatibility of the workspace format whenever possible.
- Before handoff, run focused tests, `bun run test`, `bun run typecheck`, `bun run lint`, `bun run format:check`, the production build, and workspace validation.
- `bun run binary` builds the native standalone executable. `bun run test:binary` verifies it from an isolated temporary directory, including daemon startup, HTTP assets, global session discovery, and shutdown.
