import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";

import { validateWorkspace } from "../src/lib/workspace/validator.ts";
import { LOCAL_DEV_SERVER_ARGS, runCli } from "../src/cli.ts";
import { BoardStore } from "../src/lib/store.ts";
import { readWorkspaceBoard, writeWorkspaceBoard } from "../src/lib/workspace/board-repository.ts";
import { runScheduledRule } from "../src/lib/workspace/rule-runner.ts";

const now = "2026-07-20T12:00:00Z";

async function write(root: string, file: string, contents: string) {
  await writeFile(join(root, file), contents.trimStart(), "utf8");
}

async function makeWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "flowmark-workspace-"));
  const directories = [
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
  ];
  await Promise.all(
    directories.map((directory) => mkdir(join(root, directory), { recursive: true })),
  );
  await write(
    root,
    "flowmark.yaml",
    `
schema_version: 1
workspace: { id: workspace_test, name: Test Workspace, created_at: ${now}, timezone: Europe/Amsterdam }
paths: { cards: cards, columns: columns, tags: tags, rules: rules, comments: comments, checklists: checklists, templates: templates, archive: archive, system: .flowmark }
defaults: { initial_column_id: column_today }
ui: { column_order: [column_today, column_done] }
`,
  );
  for (const [id, name, position, completed] of [
    ["column_today", "Today", 1024, false],
    ["column_done", "Done", 2048, true],
  ] as const) {
    await write(
      root,
      `columns/${id}.yaml`,
      `
schema_version: 1
id: ${id}
name: ${name}
position: ${position}
color: neutral
created_at: ${now}
updated_at: ${now}
`,
    );
  }
  await write(
    root,
    "tags/tag_work.yaml",
    `
schema_version: 1
id: tag_work
name: Work
color: blue
description: null
created_at: ${now}
updated_at: ${now}
`,
  );
  await write(
    root,
    "checklists/checklist_review.yaml",
    `
schema_version: 1
id: checklist_review
card_id: card_review
title: Review steps
position: 1024
created_at: ${now}
updated_at: ${now}
items: [{ id: item_read, text: Read document, completed: false, position: 1024 }]
`,
  );
  await write(
    root,
    "comments/comment_note.md",
    `
---
schema_version: 1
id: comment_note
card_id: card_review
author: local-user
created_at: ${now}
updated_at: ${now}
---

Review the document before shipping.
`,
  );
  await write(
    root,
    "cards/card_review.md",
    `
---
schema_version: 1
id: card_review
title: Review document
column_id: column_today
position: 1024
completed: false
completed_at: null
due_at: null
tag_ids: [tag_work]
checklist_ids: [checklist_review]
comment_ids: [comment_note]
created_at: ${now}
updated_at: ${now}
archived_at: null
---

Keep this Markdown body intact.
`,
  );
  return root;
}

test("loads a valid workspace and resolves resource ownership", async () => {
  const root = await makeWorkspace();
  try {
    const result = await validateWorkspace(root);
    assert.deepEqual(result.errors, []);
    assert.equal(result.workspace?.cards.get("card_review")?.columnId, "column_today");
    assert.equal(result.workspace?.checklists.get("checklist_review")?.cardId, "card_review");
    assert.equal(
      result.workspace?.comments.get("comment_note")?.body.trim(),
      "Review the document before shipping.",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace themes are explicit, validated, and optional for existing workspaces", async () => {
  const supportedThemes = [
    "flow-neutral",
    "one-dark",
    "nord",
    "catppuccin-mocha",
    "tokyo-night",
    "gruvbox-dark",
    "solarized-light",
    "rose-pine",
  ];

  for (const theme of supportedThemes) {
    const root = await makeWorkspace();
    try {
      const workspacePath = join(root, "flowmark.yaml");
      await writeFile(
        workspacePath,
        (await readFile(workspacePath, "utf8")).replace(
          "ui: { column_order: [column_today, column_done] }",
          `ui: { column_order: [column_today, column_done], theme: ${theme} }`,
        ),
      );
      assert.deepEqual((await validateWorkspace(root, { strict: true })).errors, []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  for (const theme of ["system", "unknown-theme"]) {
    const root = await makeWorkspace();
    try {
      const workspacePath = join(root, "flowmark.yaml");
      await writeFile(
        workspacePath,
        (await readFile(workspacePath, "utf8")).replace(
          "ui: { column_order: [column_today, column_done] }",
          `ui: { column_order: [column_today, column_done], theme: ${theme} }`,
        ),
      );
      const error = (await validateWorkspace(root)).errors.find(
        (diagnostic) => diagnostic.code === "E_INVALID_THEME",
      );
      assert.equal(error?.fieldPath, "ui.theme");
      assert.equal(error?.value, theme);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("rejects an invalid workspace timezone before starting the UI or rules", async () => {
  const root = await makeWorkspace();
  try {
    const workspacePath = join(root, "flowmark.yaml");
    await writeFile(
      workspacePath,
      (await readFile(workspacePath, "utf8")).replace("Europe/Amsterdam", "Not/A_Timezone"),
    );

    const result = await validateWorkspace(root);

    assert.equal(result.errors[0]?.code, "E_INVALID_TIMEZONE");
    assert.equal(result.errors[0]?.fieldPath, "workspace.timezone");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports a missing column reference with an actionable stable error", async () => {
  const root = await makeWorkspace();
  try {
    const cardPath = join(root, "cards/card_review.md");
    await writeFile(
      cardPath,
      (await readFile(cardPath, "utf8")).replace("column_today", "column_missing"),
    );
    const result = await validateWorkspace(root);
    assert.deepEqual(
      result.errors.map((error) => error.code),
      ["E_REF_COLUMN_NOT_FOUND"],
    );
    assert.equal(result.errors[0]?.filePath, "cards/card_review.md");
    assert.equal(result.errors[0]?.fieldPath, "frontmatter.column_id");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("warns for unknown fields and makes them errors in strict mode", async () => {
  const root = await makeWorkspace();
  try {
    const cardPath = join(root, "cards/card_review.md");
    await writeFile(
      cardPath,
      (await readFile(cardPath, "utf8")).replace(
        "title: Review document",
        "title: Review document\nlegacy_hint: retain-me",
      ),
    );
    assert.equal((await validateWorkspace(root)).warnings[0]?.code, "W_UNKNOWN_FIELD");
    assert.equal(
      (await validateWorkspace(root, { strict: true })).errors[0]?.code,
      "E_UNKNOWN_FIELD",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects workspace and column behavior policy outside rules in strict mode", async () => {
  const root = await makeWorkspace();
  try {
    const workspacePath = join(root, "flowmark.yaml");
    await writeFile(
      workspacePath,
      (await readFile(workspacePath, "utf8")).replace(
        "defaults: { initial_column_id: column_today }",
        "defaults: { initial_column_id: column_today, completed_column_id: column_done, archive_after_days: 30 }",
      ),
    );
    const columnPath = join(root, "columns/column_done.yaml");
    await writeFile(
      columnPath,
      `${await readFile(columnPath, "utf8")}defaults: { completed: true }\nbehavior: { mark_completed_on_enter: true }\n`,
    );

    const fields = (await validateWorkspace(root, { strict: true })).errors.map(
      (error) => error.fieldPath,
    );
    assert.ok(fields.includes("defaults.completed_column_id"));
    assert.ok(fields.includes("defaults.archive_after_days"));
    assert.ok(fields.includes("defaults"));
    assert.ok(fields.includes("behavior"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects duplicate card IDs across active and archive locations", async () => {
  const root = await makeWorkspace();
  try {
    await write(
      root,
      "archive/cards/card_review.md",
      `
---
schema_version: 1
id: card_review
title: Archived review
column_id: null
previous_column_id: column_today
position: 1024
completed: true
completed_at: ${now}
due_at: null
tag_ids: []
checklist_ids: []
comment_ids: []
created_at: ${now}
updated_at: ${now}
archived_at: ${now}
---

Archived body.
`,
    );
    const result = await validateWorkspace(root);
    assert.ok(result.errors.some((error) => error.code === "E_DUPLICATE_COMPONENT_ID"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("requires completed_at to agree with card completion state", async () => {
  const root = await makeWorkspace();
  try {
    const cardPath = join(root, "cards/card_review.md");
    await writeFile(
      cardPath,
      (await readFile(cardPath, "utf8")).replace("completed_at: null", `completed_at: ${now}`),
    );
    assert.ok(
      (await validateWorkspace(root)).errors.some(
        (error) => error.code === "E_INVALID_COMPLETION_STATE",
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects invalid canonical rule references and cron expressions", async () => {
  const root = await makeWorkspace();
  try {
    await write(
      root,
      "rules/rule_invalid.yaml",
      `
schema_version: 1
id: rule_invalid
name: Bad schedule
enabled: true
trigger: { type: schedule, cron: not-a-cron, timezone: Europe/Amsterdam }
conditions: [{ type: completed_age_days, operator: greater_than_or_equal, value: thirty }]
actions: [{ type: move_card, column_id: column_missing }]
created_at: ${now}
updated_at: ${now}
`,
    );
    const codes = (await validateWorkspace(root)).errors.map((error) => error.code);
    assert.ok(codes.includes("E_INVALID_CRON"));
    assert.ok(codes.includes("E_INVALID_RULE_CONDITION"));
    assert.ok(codes.includes("E_REF_COLUMN_NOT_FOUND"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("validation rejects obvious multi-rule move cycles before startup", async () => {
  const root = await makeWorkspace();
  try {
    await write(
      root,
      "rules/rule_today_to_done.yaml",
      `
schema_version: 1
id: rule_today_to_done
name: Today to Done
enabled: true
trigger: { type: card_entered_column, column_id: column_today }
actions: [{ type: move_card, column_id: column_done }]
created_at: ${now}
updated_at: ${now}
`,
    );
    await write(
      root,
      "rules/rule_done_to_today.yaml",
      `
schema_version: 1
id: rule_done_to_today
name: Done to Today
enabled: true
trigger: { type: card_entered_column, column_id: column_done }
actions: [{ type: move_card, column_id: column_today }]
created_at: ${now}
updated_at: ${now}
`,
    );

    const result = await validateWorkspace(root, { strict: true });
    assert.equal(
      result.errors.some((diagnostic) => diagnostic.code === "E_RULE_CYCLE"),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("executes scheduled completed-age archive rules from canonical sources", async () => {
  const root = await makeWorkspace();
  try {
    const cardPath = join(root, "cards/card_review.md");
    await writeFile(
      cardPath,
      (await readFile(cardPath, "utf8"))
        .replace("completed: false", "completed: true")
        .replace("completed_at: null", "completed_at: 2026-06-01T12:00:00Z"),
    );
    await write(
      root,
      "rules/rule_archive_completed.yaml",
      `
schema_version: 1
id: rule_archive_completed
name: Archive completed cards after 30 days
enabled: true
trigger: { type: schedule, cron: "0 3 * * *", timezone: Europe/Amsterdam }
conditions:
  - { type: completed, value: true }
  - { type: completed_age_days, operator: greater_than_or_equal, value: 30 }
actions: [{ type: archive_card }]
created_at: ${now}
updated_at: ${now}
`,
    );

    assert.equal(await runScheduledRule(root, "rule_archive_completed", new Date(now)), 1);
    assert.match(
      await readFile(join(root, "archive/cards/card_review.md"), "utf8"),
      /previous_column_id: column_today/,
    );
    assert.equal((await validateWorkspace(root)).errors.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("every scheduled condition executes every canonical action", async () => {
  const executionTime = new Date("2026-07-22T22:30:00Z");
  const conditionCases = [
    {
      name: "column",
      source: "{ type: column, column_id: column_today }",
      setup: {},
    },
    {
      name: "tag",
      source: "{ type: tag, tag_id: tag_work }",
      setup: { tagIds: ["tag_work"] },
    },
    {
      name: "completed",
      source: "{ type: completed, value: true }",
      setup: { completed: true, completedAt: "2026-07-20T12:00:00Z" },
    },
    {
      name: "due state",
      source: "{ type: due_state, value: today }",
      setup: { dueAt: "2026-07-23T00:00:00Z" },
    },
    {
      name: "created age",
      source: "{ type: created_age_days, operator: greater_than_or_equal, value: 2 }",
      setup: { createdAt: "2026-07-20T12:00:00Z" },
    },
    {
      name: "completed age",
      source: "{ type: completed_age_days, operator: greater_than_or_equal, value: 2 }",
      setup: { completed: true, completedAt: "2026-07-20T12:00:00Z" },
    },
  ] as const;
  const actionCases = [
    {
      name: "move card",
      source: "{ type: move_card, column_id: column_done }",
      setup: {},
      assertApplied: async (root: string) => {
        const board = await readWorkspaceBoard(root);
        assert.equal(
          board.columns.find((column) => column.id === "column_done")?.cardIds[0],
          "card_review",
        );
      },
    },
    {
      name: "set due date",
      source: "{ type: set_due_date, mode: offset, offset_days: 0 }",
      setup: {},
      assertApplied: async (root: string) => {
        assert.equal((await readWorkspaceBoard(root)).cards.card_review?.dueDate, "2026-07-23");
      },
    },
    {
      name: "clear due date",
      source: "{ type: clear_due_date }",
      setup: { dueAt: "2026-07-30T00:00:00Z" },
      assertApplied: async (root: string) => {
        assert.equal((await readWorkspaceBoard(root)).cards.card_review?.dueDate, null);
      },
    },
    {
      name: "add tag",
      source: "{ type: add_tag, tag_id: tag_work }",
      setup: { tagIds: [] },
      assertApplied: async (root: string) => {
        assert.deepEqual((await readWorkspaceBoard(root)).cards.card_review?.tagIds, ["tag_work"]);
      },
    },
    {
      name: "remove tag",
      source: "{ type: remove_tag, tag_id: tag_work }",
      setup: { tagIds: ["tag_work"] },
      assertApplied: async (root: string) => {
        assert.deepEqual((await readWorkspaceBoard(root)).cards.card_review?.tagIds, []);
      },
    },
    {
      name: "mark completed",
      source: "{ type: mark_completed }",
      setup: { completed: false, completedAt: null },
      assertApplied: async (root: string) => {
        const card = (await readWorkspaceBoard(root)).cards.card_review;
        assert.equal(card?.completed, true);
        assert.ok(card?.completedAt);
      },
    },
    {
      name: "mark uncompleted",
      source: "{ type: mark_uncompleted }",
      setup: { completed: true, completedAt: "2026-07-20T12:00:00Z" },
      assertApplied: async (root: string) => {
        const card = (await readWorkspaceBoard(root)).cards.card_review;
        assert.equal(card?.completed, false);
        assert.equal(card?.completedAt, null);
      },
    },
    {
      name: "archive card",
      source: "{ type: archive_card }",
      setup: {},
      assertApplied: async (root: string) => {
        assert.equal((await readWorkspaceBoard(root)).cards.card_review, undefined);
        assert.match(
          await readFile(join(root, "archive/cards/card_review.md"), "utf8"),
          /archived_at:/,
        );
      },
    },
  ] as const;

  for (const conditionCase of conditionCases) {
    for (const actionCase of actionCases) {
      const root = await makeWorkspace();
      try {
        const setup = {
          completed: false,
          completedAt: null as string | null,
          dueAt: null as string | null,
          tagIds: [] as string[],
          createdAt: "2026-07-20T12:00:00Z",
          ...actionCase.setup,
          ...conditionCase.setup,
        };
        await write(
          root,
          "cards/card_review.md",
          `
---
schema_version: 1
id: card_review
title: Review document
column_id: column_today
position: 1024
completed: ${setup.completed}
completed_at: ${setup.completedAt ?? "null"}
due_at: ${setup.dueAt ?? "null"}
tag_ids: [${setup.tagIds.join(", ")}]
checklist_ids: [checklist_review]
comment_ids: [comment_note]
created_at: ${setup.createdAt}
updated_at: ${now}
archived_at: null
---

Keep this Markdown body intact.
`,
        );
        await write(
          root,
          "rules/rule_matrix.yaml",
          `
schema_version: 1
id: rule_matrix
name: Matrix rule
enabled: true
trigger: { type: schedule, cron: "0 8 * * *", timezone: Europe/Amsterdam }
conditions: [${conditionCase.source}]
actions: [${actionCase.source}]
created_at: ${now}
updated_at: ${now}
`,
        );

        const actionIsNoOp =
          (actionCase.name === "set due date" && setup.dueAt === "2026-07-23T00:00:00Z") ||
          (actionCase.name === "clear due date" && setup.dueAt === null) ||
          (actionCase.name === "add tag" &&
            (setup.tagIds as readonly string[]).includes("tag_work")) ||
          (actionCase.name === "remove tag" &&
            !(setup.tagIds as readonly string[]).includes("tag_work")) ||
          (actionCase.name === "mark completed" && setup.completed) ||
          (actionCase.name === "mark uncompleted" && !setup.completed);
        assert.equal(
          await runScheduledRule(root, "rule_matrix", executionTime),
          actionIsNoOp ? 0 : 1,
        );
        await actionCase.assertApplied(root);
        assert.deepEqual((await validateWorkspace(root)).errors, []);
      } catch (error) {
        throw new Error(`${conditionCase.name} + ${actionCase.name} failed`, { cause: error });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  }
});

test("repair creates only disposable runtime directories", async () => {
  const root = await makeWorkspace();
  try {
    const source = await readFile(join(root, "cards/card_review.md"), "utf8");
    const result = await runCli(["repair"], { cwd: root, write: () => {} });
    assert.equal(result.exitCode, 0);
    assert.equal(await readFile(join(root, "cards/card_review.md"), "utf8"), source);
    assert.deepEqual(
      await Promise.all(
        ["cache", "indexes", "jobs", "locks"].map((directory) =>
          import("node:fs/promises").then(({ stat }) =>
            stat(join(root, ".flowmark", directory)).then((entry) => entry.isDirectory()),
          ),
        ),
      ),
      [true, true, true, true],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("serve validates the workspace before starting background services", async () => {
  const root = await makeWorkspace();
  let started = false;
  let jobsStarted = false;
  try {
    const result = await runCli(["serve"], {
      cwd: root,
      startJobs: async () => {
        jobsStarted = true;
        return () => {};
      },
      startServer: async () => {
        started = true;
      },
    });
    assert.equal(result.exitCode, 0);
    assert.equal(started, true);
    assert.equal(jobsStarted, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the default server command binds loopback only", () => {
  assert.deepEqual(LOCAL_DEV_SERVER_ARGS, ["run", "dev", "--", "--host", "127.0.0.1"]);
});

test("help flags and help command describe the supported CLI", async () => {
  for (const args of [["-h"], ["--help"], ["help"]]) {
    const output: string[] = [];
    const result = await runCli(args, { write: (message) => output.push(message) });

    assert.equal(result.exitCode, 0);
    assert.match(output.join("\n"), /flowmark init/);
    assert.match(output.join("\n"), /flowmark validate/);
    assert.match(output.join("\n"), /flowmark schema/);
    assert.match(output.join("\n"), /flowmark update/);
    assert.doesNotMatch(output.join("\n"), /flowmark migrate/);
  }
});

test("update works outside a workspace and reports the replaced executable", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-update-cli-"));
  const output: string[] = [];
  let calls = 0;
  try {
    const result = await runCli(["update"], {
      cwd: root,
      runUpdate: async () => {
        calls++;
        return {
          asset: "flowmark-darwin-arm64.tar.gz",
          executablePath: "/custom/bin/flowmark",
        };
      },
      write: (message) => output.push(message),
    });

    assert.equal(result.exitCode, 0);
    assert.equal(calls, 1);
    assert.match(output.join("\n"), /updated flowmark/i);
    assert.match(output.join("\n"), /\/custom\/bin\/flowmark/);
    assert.match(output.join("\n"), /restart.*sessions/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("update refuses source mode without validating the current directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-update-source-"));
  const output: string[] = [];
  try {
    const result = await runCli(["update"], {
      cwd: root,
      write: (message) => output.push(message),
    });

    assert.equal(result.exitCode, 1);
    assert.match(output.join("\n"), /source checkout/i);
    assert.match(output.join("\n"), /git pull/i);
    assert.doesNotMatch(output.join("\n"), /cannot update bun/i);
    assert.doesNotMatch(output.join("\n"), /workspace validation/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("update rejects arguments instead of silently installing a different request", async () => {
  const output: string[] = [];
  let calls = 0;
  const result = await runCli(["update", "v9.9.9"], {
    runUpdate: async () => {
      calls++;
      return { asset: "unused", executablePath: "unused" };
    },
    write: (message) => output.push(message),
  });

  assert.equal(result.exitCode, 2);
  assert.equal(calls, 0);
  assert.match(output.join("\n"), /usage: flowmark update/i);
});

test("update reports download or installation failures without throwing", async () => {
  const output: string[] = [];
  const result = await runCli(["update"], {
    runUpdate: async () => {
      throw new Error("Checksum verification failed for release archive.");
    },
    write: (message) => output.push(message),
  });

  assert.equal(result.exitCode, 1);
  assert.equal(output.join("\n"), "Checksum verification failed for release archive.");
});

test("schema command lists and renders component contracts without a workspace", async () => {
  const listed: string[] = [];
  assert.equal(
    (await runCli(["schema"], { cwd: "/does/not/need/a/workspace", write: (m) => listed.push(m) }))
      .exitCode,
    0,
  );
  assert.match(
    listed.join("\n"),
    /workspace, card, column, tag, rule, comment, checklist, template/,
  );
  assert.match(listed.join("\n"), /flowmark schema rule/);

  const yaml: string[] = [];
  assert.equal((await runCli(["schema", "rule"], { write: (m) => yaml.push(m) })).exitCode, 0);
  assert.equal((parse(yaml.join("\n")) as { component: string }).component, "rule");

  const json: string[] = [];
  assert.equal(
    (await runCli(["schema", "card", "--format", "json"], { write: (m) => json.push(m) })).exitCode,
    0,
  );
  assert.equal(JSON.parse(json.join("\n")).component, "card");

  const all: string[] = [];
  assert.equal(
    (await runCli(["schema", "--all", "--format", "yaml"], { write: (m) => all.push(m) })).exitCode,
    0,
  );
  assert.equal(Object.keys((parse(all.join("\n")) as { schemas: object }).schemas).length, 8);
});

test("schema command rejects unknown components and formats", async () => {
  for (const args of [
    ["schema", "board"],
    ["schema", "rule", "--format", "toml"],
  ]) {
    const output: string[] = [];
    const result = await runCli(args, { write: (message) => output.push(message) });
    assert.equal(result.exitCode, 2);
    assert.match(output.join("\n"), /Unknown (component schema|schema format)/);
  }
});

test("the removed migrate command is rejected", async () => {
  const output: string[] = [];
  const result = await runCli(["migrate"], {
    write: (message) => output.push(message),
  });

  assert.equal(result.exitCode, 2);
  assert.doesNotMatch(output.join("\n"), /flowmark migrate/);
});

test("a missing workspace recommends flowmark init", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-empty-"));
  const output: string[] = [];
  try {
    const result = await runCli(["validate"], {
      cwd: root,
      write: (message) => output.push(message),
    });

    assert.equal(result.exitCode, 1);
    assert.match(output.join("\n"), /flowmark init/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init creates a minimal strictly valid workspace and agent guidance", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-init-"));
  try {
    const result = await runCli(["init"], { cwd: root, write: () => {} });

    assert.equal(result.exitCode, 0);
    const workspaceSource = await readFile(join(root, "flowmark.yaml"), "utf8");
    assert.match(workspaceSource, /column_inbox/);
    assert.match(workspaceSource, /theme: flow-neutral/);
    await assert.rejects(() => readFile(join(root, "workspace.yaml"), "utf8"));
    assert.match(await readFile(join(root, "columns/column_inbox.yaml"), "utf8"), /name: Inbox/);
    assert.match(await readFile(join(root, ".gitignore"), "utf8"), /^\.flowmark\/$/m);
    const agentGuidance = await readFile(join(root, "AGENTS.md"), "utf8");
    assert.match(agentGuidance, /filesystem is the database/i);
    assert.match(agentGuidance, /flowmark validate --strict/);
    assert.match(agentGuidance, /flowmark schema <component>/);
    assert.match(agentGuidance, /flowmark schema --all/);
    assert.match(agentGuidance, /inspect.*schema.*before editing/i);
    assert.match(agentGuidance, /create, move, update, complete, and archive cards/i);
    assert.match(agentGuidance, /flowmark-card-links: ask/);
    assert.match(agentGuidance, /cards\/<card_id>\.md/);
    assert.doesNotMatch(agentGuidance, /flowmark link <card_id>\s+--format\b/);
    assert.match(agentGuidance, /`flowmark link <card_id>`/);
    assert.match(agentGuidance, /replace.*ask.*always.*never/is);
    for (const directory of [
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
      ".flowmark/cache",
      ".flowmark/indexes",
      ".flowmark/jobs",
      ".flowmark/locks",
    ]) {
      assert.equal(
        await import("node:fs/promises").then(({ stat }) =>
          stat(join(root, directory)).then((entry) => entry.isDirectory()),
        ),
        true,
      );
    }
    assert.deepEqual((await validateWorkspace(root, { strict: true })).errors, []);
    await assert.rejects(() =>
      import("node:fs/promises").then(({ stat }) => stat(join(root, ".kanban"))),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init is idempotent and restores only missing scaffolding", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-init-repeat-"));
  try {
    assert.equal((await runCli(["init"], { cwd: root, write: () => {} })).exitCode, 0);
    const rootSource = await readFile(join(root, "flowmark.yaml"), "utf8");
    const columnSource = await readFile(join(root, "columns/column_inbox.yaml"), "utf8");
    await rm(join(root, ".flowmark/cache"), { recursive: true, force: true });

    assert.equal((await runCli(["init"], { cwd: root, write: () => {} })).exitCode, 0);
    assert.equal(await readFile(join(root, "flowmark.yaml"), "utf8"), rootSource);
    assert.equal(await readFile(join(root, "columns/column_inbox.yaml"), "utf8"), columnSource);
    assert.equal(
      await import("node:fs/promises").then(({ stat }) =>
        stat(join(root, ".flowmark/cache")).then((entry) => entry.isDirectory()),
      ),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init preserves existing project guidance and ignore rules", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-init-preserve-"));
  try {
    await write(root, "AGENTS.md", "# Existing agent rules\n");
    await write(root, ".gitignore", "custom-output/\n");

    assert.equal((await runCli(["init"], { cwd: root, write: () => {} })).exitCode, 0);
    assert.equal(await readFile(join(root, "AGENTS.md"), "utf8"), "# Existing agent rules\n");
    assert.equal(await readFile(join(root, ".gitignore"), "utf8"), "custom-output/\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init refuses managed source conflicts before writing authoritative files", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-init-conflict-"));
  const output: string[] = [];
  try {
    await mkdir(join(root, "cards"));
    await write(root, "cards/project-notes.md", "Not a Flowmark card.\n");

    const result = await runCli(["init"], {
      cwd: root,
      write: (message) => output.push(message),
    });

    assert.equal(result.exitCode, 1);
    assert.match(output.join("\n"), /cards\/project-notes\.md/);
    await assert.rejects(() => readFile(join(root, "flowmark.yaml"), "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init recovers its canonical Inbox file after an interrupted first run", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-init-recover-"));
  try {
    await mkdir(join(root, "columns"));
    await write(
      root,
      "columns/column_inbox.yaml",
      `
schema_version: 1
id: column_inbox
name: Inbox
position: 1024
color: neutral
created_at: ${now}
updated_at: ${now}
`,
    );
    const columnSource = await readFile(join(root, "columns/column_inbox.yaml"), "utf8");

    const result = await runCli(["init"], { cwd: root, write: () => {} });

    assert.equal(result.exitCode, 0);
    assert.equal(await readFile(join(root, "columns/column_inbox.yaml"), "utf8"), columnSource);
    assert.deepEqual((await validateWorkspace(root, { strict: true })).errors, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init does not recover a malformed Inbox file as its own scaffold", async () => {
  const root = await mkdtemp(join(tmpdir(), "flowmark-init-malformed-"));
  const output: string[] = [];
  try {
    await mkdir(join(root, "columns"));
    await write(
      root,
      "columns/column_inbox.yaml",
      `
schema_version: 1
id: column_inbox
name: Unrelated Inbox
position: 1024
color: neutral
created_at: ${now}
updated_at: ${now}
`,
    );

    const result = await runCli(["init"], {
      cwd: root,
      write: (message) => output.push(message),
    });

    assert.equal(result.exitCode, 1);
    assert.match(output.join("\n"), /columns\/column_inbox\.yaml/);
    await assert.rejects(() => readFile(join(root, "flowmark.yaml"), "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("projects validated resources into the board used by the UI", async () => {
  const root = await makeWorkspace();
  try {
    const board = await readWorkspaceBoard(root);
    assert.deepEqual(
      board.columns.map((column) => column.id),
      ["column_today", "column_done"],
    );
    assert.equal(board.cards.card_review?.description.trim(), "Keep this Markdown body intact.");
    assert.equal(board.cards.card_review?.checklist[0]?.text, "Read document");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persists a board edit as validated canonical source files", async () => {
  const root = await makeWorkspace();
  try {
    const board = await readWorkspaceBoard(root);
    board.cards.card_review!.title = "Updated review";
    board.cards.card_review!.description = "Edited Markdown body.\n";
    await writeWorkspaceBoard(root, board);
    const reloaded = await readWorkspaceBoard(root);
    assert.equal(reloaded.cards.card_review?.title, "Updated review");
    assert.equal(reloaded.cards.card_review?.description, "Edited Markdown body.\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persists an edited Markdown comment through the store as valid source", async () => {
  const root = await makeWorkspace();
  try {
    const store = new BoardStore(
      {
        read: async () => ({ path: root, board: await readWorkspaceBoard(root) }),
        save: async (board) => {
          await writeWorkspaceBoard(root, board);
          return { path: root };
        },
      },
      10_000,
    );
    await store.reloadFromDisk();

    store.updateComment(
      "card_review",
      "comment_note",
      "Read [the release notes](https://example.com/release) before shipping.",
    );
    await store.flushPendingSave();

    const source = await readFile(join(root, "comments/comment_note.md"), "utf8");
    assert.match(source, /Read \[the release notes\]\(https:\/\/example\.com\/release\)/);
    assert.equal(
      (await readWorkspaceBoard(root)).cards.card_review?.comments[0]?.body.trim(),
      "Read [the release notes](https://example.com/release) before shipping.",
    );
    assert.deepEqual((await validateWorkspace(root, { strict: true })).errors, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a no-op board write leaves every authoritative source byte-identical", async () => {
  const root = await makeWorkspace();
  const files = [
    "flowmark.yaml",
    "cards/card_review.md",
    "columns/column_today.yaml",
    "columns/column_done.yaml",
    "tags/tag_work.yaml",
    "checklists/checklist_review.yaml",
    "comments/comment_note.md",
  ];
  try {
    const before = await Promise.all(files.map((file) => readFile(join(root, file), "utf8")));
    await writeWorkspaceBoard(root, await readWorkspaceBoard(root));
    const after = await Promise.all(files.map((file) => readFile(join(root, file), "utf8")));
    assert.deepEqual(after, before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a card-only edit does not rewrite unrelated workspace resources", async () => {
  const root = await makeWorkspace();
  const unrelated = [
    "flowmark.yaml",
    "columns/column_today.yaml",
    "columns/column_done.yaml",
    "tags/tag_work.yaml",
    "checklists/checklist_review.yaml",
    "comments/comment_note.md",
  ];
  try {
    const before = await Promise.all(unrelated.map((file) => readFile(join(root, file), "utf8")));
    const board = await readWorkspaceBoard(root);
    board.cards.card_review!.title = "Only this card changed";
    await writeWorkspaceBoard(root, board);
    const after = await Promise.all(unrelated.map((file) => readFile(join(root, file), "utf8")));
    assert.deepEqual(after, before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persists the completion timestamp used by age-based rules", async () => {
  const root = await makeWorkspace();
  try {
    const board = await readWorkspaceBoard(root);
    board.cards.card_review!.completed = true;
    board.cards.card_review!.completedAt = now;
    await writeWorkspaceBoard(root, board);
    const source = await readFile(join(root, "cards/card_review.md"), "utf8");
    assert.match(source, /completed: true/);
    assert.match(source, /completed_at: 2026-07-20T12:00:00Z/);
    assert.equal((await validateWorkspace(root)).errors.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("never serializes validator-only metadata into canonical YAML", async () => {
  const root = await makeWorkspace();
  try {
    const board = await readWorkspaceBoard(root);
    board.columns[0]!.name = "Today renamed";
    await writeWorkspaceBoard(root, board);
    assert.doesNotMatch(
      await readFile(join(root, "columns/column_today.yaml"), "utf8"),
      /__filePath/,
    );
    assert.doesNotMatch(
      await readFile(join(root, "columns/column_today.yaml"), "utf8"),
      /defaults:|behavior:/,
    );
    assert.doesNotMatch(await readFile(join(root, "tags/tag_work.yaml"), "utf8"), /__filePath/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("archives removed active cards instead of silently deleting their source history", async () => {
  const root = await makeWorkspace();
  try {
    const board = await readWorkspaceBoard(root);
    delete board.cards.card_review;
    board.columns[0]!.cardIds = [];
    await writeWorkspaceBoard(root, board);
    const archive = await readFile(join(root, "archive/cards/card_review.md"), "utf8");
    assert.match(archive, /column_id: null/);
    assert.match(archive, /previous_column_id: column_today/);
    await assert.rejects(() => readFile(join(root, "cards/card_review.md"), "utf8"));
    assert.deepEqual((await validateWorkspace(root)).errors, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("failed tag deletion cannot leave archived card references broken", async () => {
  const root = await makeWorkspace();
  try {
    const board = await readWorkspaceBoard(root);
    delete board.cards.card_review;
    board.columns[0]!.cardIds = [];
    await writeWorkspaceBoard(root, board);

    const withoutTag = await readWorkspaceBoard(root);
    withoutTag.tags = [];
    await assert.rejects(() => writeWorkspaceBoard(root, withoutTag), /E_REF_TAG_NOT_FOUND/);

    assert.match(await readFile(join(root, "tags/tag_work.yaml"), "utf8"), /id: tag_work/);
    assert.deepEqual((await validateWorkspace(root)).errors, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("failed column deletion cannot leave archived previous_column_id broken", async () => {
  const root = await makeWorkspace();
  try {
    const moved = await readWorkspaceBoard(root);
    moved.columns[0]!.cardIds = [];
    moved.columns[1]!.cardIds = ["card_review"];
    await writeWorkspaceBoard(root, moved);

    const archived = await readWorkspaceBoard(root);
    delete archived.cards.card_review;
    archived.columns[1]!.cardIds = [];
    await writeWorkspaceBoard(root, archived);

    const withoutDone = await readWorkspaceBoard(root);
    withoutDone.columns = withoutDone.columns.filter((column) => column.id !== "column_done");
    await assert.rejects(() => writeWorkspaceBoard(root, withoutDone), /E_REF_COLUMN_NOT_FOUND/);

    assert.match(await readFile(join(root, "columns/column_done.yaml"), "utf8"), /id: column_done/);
    assert.deepEqual((await validateWorkspace(root)).errors, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
