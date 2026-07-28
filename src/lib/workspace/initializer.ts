import { mkdir, readdir, readFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { parse, stringify } from "yaml";

import { atomicCreate } from "./file-transaction";
import { validateWorkspace, type ValidationResult } from "./validator";

const SOURCE_DIRECTORIES = [
  "cards",
  "columns",
  "tags",
  "rules",
  "comments",
  "checklists",
  "templates",
  "archive/cards",
  "archive/comments",
  "archive/checklists",
] as const;

const RUNTIME_DIRECTORIES = ["cache", "indexes", "jobs", "locks"] as const;

export const FLOWMARK_AGENT_GUIDANCE = `# Flowmark task-management rules

## Source of truth

- The filesystem is the database. \`flowmark.yaml\`, \`cards/\`, \`columns/\`, \`tags/\`, \`rules/\`, \`comments/\`, \`checklists/\`, \`templates/\`, and \`archive/\` are authoritative.
- Markdown and YAML files are the only source of truth. Never introduce or depend on a database, browser storage, cache, or generated index for task semantics.
- \`.flowmark/\` is disposable runtime state. Never store the only copy of task data there and do not edit it to change tasks.
- Work locally by default. Never send task contents to a network service unless the user explicitly requests it.

## Editing tasks as an agent

- You may create, move, update, complete, and archive cards by editing their source files.
- Inspect the current component schema before editing a resource: run \`flowmark schema <component>\` (for example, \`flowmark schema rule\`). Run \`flowmark schema --all\` to retrieve every current component schema. Prefer these commands over copying field lists into agent instructions, because the command stays current with Flowmark releases.
- Read \`flowmark.yaml\` and the relevant component files before editing. Preserve unknown Markdown body content and fields you do not intentionally change.
- Every resource ID is immutable, lowercase, URL-safe, type-prefixed, and matches its filename. References always use IDs, never display names.
- File order never defines board order. Use numeric \`position\` values and keep them non-negative.
- To create a card, create \`cards/<card_id>.md\` with complete schema-version-1 frontmatter, a valid \`column_id\`, timestamps, position, and explicit tag/checklist/comment ID arrays.
- To move a card, update \`column_id\` and \`position\`. Renaming a title must never change its ID or references.
- To complete a card, set \`completed: true\` and set \`completed_at\` to the completion time. To reopen it, set \`completed: false\` and \`completed_at: null\`.
- Columns are structural only. Completion, due-date, transition, and archive behavior belongs in \`rules/\`. Inspect enabled rules before direct card actions and apply relevant deterministic event-rule outcomes once.
- Card/checklist and card/comment references are bidirectional. Update both sides together; orphaned resources are invalid.
- To archive a card, move it to \`archive/cards/\`, preserve its ID and history, set \`archived_at\`, set \`column_id: null\`, and retain the old column as \`previous_column_id\`. Preserve and archive its owned comments and checklists.
- Never silently rewrite or delete user-authored task content. Prefer small, atomic, reviewable file changes.

## Required validation

- After every task edit, run \`flowmark validate --strict\` from the workspace root.
- If validation fails, repair the source files you changed and rerun validation. Do not claim the task is ready for the UI until validation succeeds with zero errors.
`;

const FLOWMARK_GITIGNORE = `.flowmark/\n*.tmp\n*.lock\n`;

export interface InitializationResult {
  created: boolean;
  validation: ValidationResult;
}

export class WorkspaceInitializationError extends Error {}

async function exists(path: string) {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function listFiles(root: string, directory: string): Promise<string[]> {
  const absolute = join(root, directory);
  let entries;
  try {
    entries = await readdir(absolute, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = join(absolute, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, relative(root, entryPath))));
    } else {
      files.push(relative(root, entryPath).replaceAll("\\", "/"));
    }
  }
  return files;
}

async function writeIfMissing(path: string, contents: string) {
  await atomicCreate(path, contents);
}

async function isCanonicalInbox(path: string) {
  try {
    const value = parse(await readFile(path, "utf8"));
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const source = value as Record<string, unknown>;
    const keys = Object.keys(source).sort();
    return (
      keys.join(",") ===
        ["color", "created_at", "id", "name", "position", "schema_version", "updated_at"].join(
          ",",
        ) &&
      source.schema_version === 1 &&
      source.id === "column_inbox" &&
      source.name === "Inbox" &&
      source.position === 1024 &&
      source.color === "neutral" &&
      typeof source.created_at === "string" &&
      !Number.isNaN(Date.parse(source.created_at)) &&
      typeof source.updated_at === "string" &&
      !Number.isNaN(Date.parse(source.updated_at))
    );
  } catch {
    return false;
  }
}

export async function ensureRuntimeDirectories(root: string) {
  await Promise.all(
    RUNTIME_DIRECTORIES.map((directory) =>
      mkdir(join(root, ".flowmark", directory), { recursive: true }),
    ),
  );
}

async function ensureWorkspaceDirectories(root: string) {
  await Promise.all(
    SOURCE_DIRECTORIES.map((directory) => mkdir(join(root, directory), { recursive: true })),
  );
  await ensureRuntimeDirectories(root);
}

function workspaceIdentity(root: string) {
  const folderName = basename(resolve(root)) || "Flowmark Workspace";
  const slug = folderName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return {
    id: `workspace_${slug || "local"}`,
    name: folderName,
  };
}

export async function initializeWorkspace(root: string): Promise<InitializationResult> {
  const rootFile = join(root, "flowmark.yaml");
  const alreadyInitialized = await exists(rootFile);

  if (!alreadyInitialized) {
    if (await exists(join(root, "workspace.yaml"))) {
      throw new WorkspaceInitializationError(
        "workspace.yaml is an unsupported legacy root file. Rename or remove it explicitly before running flowmark init.",
      );
    }
    const conflicts = (
      await Promise.all(
        ["cards", "columns", "tags", "rules", "comments", "checklists", "templates", "archive"].map(
          (directory) => listFiles(root, directory),
        ),
      )
    ).flat();
    const recoverableInbox =
      conflicts.length === 1 &&
      conflicts[0] === "columns/column_inbox.yaml" &&
      (await isCanonicalInbox(join(root, conflicts[0])));
    if (conflicts.length > 0 && !recoverableInbox) {
      throw new WorkspaceInitializationError(
        `Cannot initialize because managed source paths already contain files: ${conflicts.join(", ")}`,
      );
    }
  }

  await ensureWorkspaceDirectories(root);
  await writeIfMissing(join(root, "AGENTS.md"), FLOWMARK_AGENT_GUIDANCE);
  await writeIfMissing(join(root, ".gitignore"), FLOWMARK_GITIGNORE);

  if (!alreadyInitialized) {
    const createdAt = new Date().toISOString();
    const identity = workspaceIdentity(root);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    await writeIfMissing(
      join(root, "columns", "column_inbox.yaml"),
      stringify(
        {
          schema_version: 1,
          id: "column_inbox",
          name: "Inbox",
          position: 1024,
          color: "neutral",
          created_at: createdAt,
          updated_at: createdAt,
        },
        { lineWidth: 0 },
      ),
    );
    await atomicCreate(
      rootFile,
      stringify(
        {
          schema_version: 1,
          workspace: { ...identity, created_at: createdAt, timezone },
          paths: {
            cards: "cards",
            columns: "columns",
            tags: "tags",
            rules: "rules",
            comments: "comments",
            checklists: "checklists",
            templates: "templates",
            archive: "archive",
            system: ".flowmark",
          },
          defaults: { initial_column_id: "column_inbox" },
          ui: { column_order: ["column_inbox"], theme: "flow-neutral" },
        },
        { lineWidth: 0 },
      ),
    );
  }

  return {
    created: !alreadyInitialized,
    validation: await validateWorkspace(root, { strict: true }),
  };
}
