# Contributing to Flowmark

Thank you for helping make local-first task management better.

## Before opening a change

- Search existing issues first.
- Keep proposals focused and explain the user problem.
- Do not add a database, cloud dependency, telemetry, or network requirement.
- Do not introduce a dependency when a small local solution is practical.
- Preserve existing workspace files and IDs. Never silently rewrite user data.

For substantial format or rule-engine changes, open an issue before
implementation so compatibility and migration boundaries can be discussed.

## Development setup

Flowmark requires Bun 1.3 or newer.

```sh
git clone <your-fork>
cd flowmark
bun install
bun run test
```

Run the example workspace:

```sh
cd example
bun run ../src/cli.ts
```

## Quality checks

Add tests before changing behavior. Before submitting a pull request, run:

```sh
bun run test
bun run typecheck
bun run lint
bun run format:check
bun run build
bun run binary
bun run test:binary
```

Changes to a component format must update the validator, the schema catalog,
the documentation, and their tests together. Confirm the exposed contract with
`flowmark schema <component>`.

## Project conventions

- Keep filesystem operations in `src/lib/workspace/` and server functions.
- Keep authoritative data in `flowmark.yaml` and source component directories.
- Treat `.flowmark/` and `~/.flowmark/sessions.json` as disposable runtime data.
- Use immutable lowercase type-prefixed IDs and ID-based references.
- Preserve Markdown bodies and fields outside the scope of an edit.
- Use atomic same-directory writes for source resources.
- Keep components small and prefer composition.
- Do not hand-edit `src/routeTree.gen.ts`.
- Keep commits logically scoped and messages imperative.

Pull requests should describe the behavior change, compatibility impact, and
verification performed. Screenshots are helpful for visible UI changes.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
