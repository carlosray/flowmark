import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { initializeWorkspace } from "../src/lib/workspace/initializer.ts";
import {
  createTemplateId,
  readWorkspaceTemplates,
  writeWorkspaceTemplates,
  type CardTemplate,
} from "../src/lib/workspace/templates-repository.ts";

const now = "2026-08-26T09:00:00Z";
const clock = new Date(now);

async function makeWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "flowmark-templates-repo-"));
  await initializeWorkspace(root);
  await writeFile(
    join(root, "tags/tag_music.yaml"),
    `schema_version: 1
id: tag_music
name: Music
color: violet
description: null
created_at: ${now}
updated_at: ${now}
`,
  );
  return root;
}

function piano(overrides: Partial<CardTemplate> = {}): CardTemplate {
  return {
    id: "template_piano",
    name: "Piano practice",
    title: "Piano · {{date+2d:long}}",
    body: "Practice on {{weekday+2d}}.\n",
    columnId: "column_inbox",
    tagIds: ["tag_music"],
    due: { mode: "offset", offsetDays: 2 },
    checklist: ["Scales", "Piece for week {{week}}"],
    ...overrides,
  };
}

async function writeRule(root: string, templateId = "template_piano") {
  await writeFile(
    join(root, "rules/rule_piano.yaml"),
    `schema_version: 1
id: rule_piano
name: Piano practice
enabled: true
trigger:
  type: schedule
  every:
    days: 3
    anchor: 2026-08-19
    at: "08:00"
actions:
  - type: create_card
    template_id: ${templateId}
created_at: ${now}
updated_at: ${now}
`,
  );
}

test("a template round-trips through write and read", async () => {
  const root = await makeWorkspace();
  await writeWorkspaceTemplates(root, { templates: [piano()], deletedIds: [] }, clock);
  const { templates, locale, timeZone } = await readWorkspaceTemplates(root);
  assert.equal(templates.length, 1);
  assert.deepEqual(templates[0], piano());
  assert.equal(typeof locale, "string");
  assert.equal(typeof timeZone, "string");
  await rm(root, { recursive: true, force: true });
});

test("a template is stored as markdown with its body below the frontmatter", async () => {
  const root = await makeWorkspace();
  await writeWorkspaceTemplates(root, { templates: [piano()], deletedIds: [] }, clock);
  const source = await readFile(join(root, "templates/template_piano.md"), "utf8");
  assert.ok(source.startsWith("---\n"));
  assert.ok(source.includes("id: template_piano"));
  assert.ok(source.trimEnd().endsWith("Practice on {{weekday+2d}}."));
  await rm(root, { recursive: true, force: true });
});

test("templates with each due mode round-trip", async () => {
  const root = await makeWorkspace();
  const templates = [
    piano({ id: "template_none", due: { mode: "none" } }),
    piano({ id: "template_offset", due: { mode: "offset", offsetDays: -1 } }),
    piano({ id: "template_fixed", due: { mode: "fixed", date: "2026-09-01" } }),
  ];
  await writeWorkspaceTemplates(root, { templates, deletedIds: [] }, clock);
  const read = await readWorkspaceTemplates(root);
  const byId = new Map(read.templates.map((template) => [template.id, template.due]));
  assert.deepEqual(byId.get("template_none"), { mode: "none" });
  assert.deepEqual(byId.get("template_offset"), { mode: "offset", offsetDays: -1 });
  assert.deepEqual(byId.get("template_fixed"), { mode: "fixed", date: "2026-09-01" });
  await rm(root, { recursive: true, force: true });
});

test("an optional column, tags, and checklist round-trip as empty", async () => {
  const root = await makeWorkspace();
  const bare = piano({ columnId: null, tagIds: [], checklist: [], body: "" });
  await writeWorkspaceTemplates(root, { templates: [bare], deletedIds: [] }, clock);
  const { templates } = await readWorkspaceTemplates(root);
  assert.deepEqual(templates[0], bare);
  await rm(root, { recursive: true, force: true });
});

test("writing a template that breaks validation rolls the workspace back", async () => {
  const root = await makeWorkspace();
  await writeWorkspaceTemplates(root, { templates: [piano()], deletedIds: [] }, clock);
  const before = await readFile(join(root, "templates/template_piano.md"), "utf8");
  await assert.rejects(
    writeWorkspaceTemplates(
      root,
      { templates: [piano({ title: "Broken {{nope}}" })], deletedIds: [] },
      clock,
    ),
  );
  assert.equal(await readFile(join(root, "templates/template_piano.md"), "utf8"), before);
  await rm(root, { recursive: true, force: true });
});

test("writing rejects a template referencing a missing column or tag", async () => {
  const root = await makeWorkspace();
  for (const broken of [piano({ columnId: "column_ghost" }), piano({ tagIds: ["tag_ghost"] })]) {
    await assert.rejects(
      writeWorkspaceTemplates(root, { templates: [broken], deletedIds: [] }, clock),
    );
  }
  await rm(root, { recursive: true, force: true });
});

test("writing rejects a malformed template ID and duplicates", async () => {
  const root = await makeWorkspace();
  await assert.rejects(
    writeWorkspaceTemplates(root, { templates: [piano({ id: "Piano" })], deletedIds: [] }, clock),
  );
  await assert.rejects(
    writeWorkspaceTemplates(root, { templates: [piano(), piano()], deletedIds: [] }, clock),
  );
  await rm(root, { recursive: true, force: true });
});

test("deleting a template referenced by a rule is refused", async () => {
  const root = await makeWorkspace();
  await writeWorkspaceTemplates(root, { templates: [piano()], deletedIds: [] }, clock);
  await writeRule(root);
  await assert.rejects(
    writeWorkspaceTemplates(root, { templates: [], deletedIds: ["template_piano"] }, clock),
    /rule_piano/,
  );
  assert.equal((await readWorkspaceTemplates(root)).templates.length, 1);
  await rm(root, { recursive: true, force: true });
});

test("deleting an unreferenced template removes its file", async () => {
  const root = await makeWorkspace();
  await writeWorkspaceTemplates(root, { templates: [piano()], deletedIds: [] }, clock);
  await writeWorkspaceTemplates(root, { templates: [], deletedIds: ["template_piano"] }, clock);
  assert.deepEqual((await readWorkspaceTemplates(root)).templates, []);
  await rm(root, { recursive: true, force: true });
});

test("rewriting a template preserves unknown frontmatter fields", async () => {
  const root = await makeWorkspace();
  await writeWorkspaceTemplates(root, { templates: [piano()], deletedIds: [] }, clock);
  const path = join(root, "templates/template_piano.md");
  const source = await readFile(path, "utf8");
  const closing = source.indexOf("\n---\n", 4);
  await writeFile(
    path,
    `${source.slice(0, closing)}\nx_future_field: kept${source.slice(closing)}`,
  );

  await writeWorkspaceTemplates(
    root,
    { templates: [piano({ name: "Renamed" })], deletedIds: [] },
    clock,
  );
  const rewritten = await readFile(path, "utf8");
  assert.ok(rewritten.includes("x_future_field: kept"));
  assert.ok(rewritten.includes("name: Renamed"));
  await rm(root, { recursive: true, force: true });
});

test("created_at survives a rewrite while updated_at advances", async () => {
  const root = await makeWorkspace();
  await writeWorkspaceTemplates(root, { templates: [piano()], deletedIds: [] }, clock);
  const later = new Date("2026-09-01T10:00:00Z");
  await writeWorkspaceTemplates(
    root,
    { templates: [piano({ name: "Renamed" })], deletedIds: [] },
    later,
  );
  const source = await readFile(join(root, "templates/template_piano.md"), "utf8");
  assert.ok(source.includes("created_at: 2026-08-26T09:00:00.000Z"));
  assert.ok(source.includes("updated_at: 2026-09-01T10:00:00.000Z"));
  await rm(root, { recursive: true, force: true });
});

test("createTemplateId produces a valid immutable ID", () => {
  for (let attempt = 0; attempt < 20; attempt += 1)
    assert.match(createTemplateId(), /^template_[a-z0-9]+(?:_[a-z0-9]+)*$/);
});
