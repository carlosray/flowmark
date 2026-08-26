import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { initializeWorkspace } from "../src/lib/workspace/initializer.ts";
import { validateWorkspace } from "../src/lib/workspace/validator.ts";

const now = "2026-08-26T09:00:00Z";

async function makeWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "flowmark-template-validation-"));
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

async function writeTemplate(root: string, frontmatter: string, body = "Practice notes.\n") {
  await writeFile(
    join(root, "templates/template_piano.md"),
    `---
${frontmatter.trim()}
---

${body}`,
  );
}

async function writeRule(root: string, contents: string) {
  await writeFile(join(root, "rules/rule_piano.yaml"), contents.trimStart());
}

const validTemplate = `
schema_version: 1
id: template_piano
name: Piano practice
card:
  title: "Piano · {{date+2d:long}}"
  column_id: column_inbox
  tag_ids: [tag_music]
  due:
    mode: offset
    offset_days: 2
checklist:
  - "Scales for {{weekday+2d}}"
created_at: ${now}
updated_at: ${now}
`;

const validRule = `
schema_version: 1
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
    template_id: template_piano
created_at: ${now}
updated_at: ${now}
`;

async function errorsFor(root: string) {
  const result = await validateWorkspace(root);
  return result.errors.map((error) => `${error.code} ${error.fieldPath}: ${error.message}`);
}

test("a workspace with a markdown template and a schedule rule validates clean", async () => {
  const root = await makeWorkspace();
  await writeTemplate(root, validTemplate);
  await writeRule(root, validRule);
  assert.deepEqual(await errorsFor(root), []);
  await rm(root, { recursive: true, force: true });
});

test("a workspace with no templates still validates", async () => {
  const root = await makeWorkspace();
  assert.deepEqual(await errorsFor(root), []);
  await rm(root, { recursive: true, force: true });
});

test("a template missing its card title is rejected", async () => {
  const root = await makeWorkspace();
  await writeTemplate(
    root,
    `
schema_version: 1
id: template_piano
name: Piano practice
card:
  column_id: column_inbox
created_at: ${now}
updated_at: ${now}
`,
  );
  assert.ok((await errorsFor(root)).some((error) => /E_REQUIRED_FIELD.*title/i.test(error)));
  await rm(root, { recursive: true, force: true });
});

test("a template with a broken expression is rejected", async () => {
  const root = await makeWorkspace();
  await writeTemplate(root, validTemplate.replace("{{date+2d:long}}", "{{nope}}"));
  assert.ok(
    (await errorsFor(root)).some((error) => error.startsWith("E_INVALID_TEMPLATE_EXPRESSION")),
  );
  await rm(root, { recursive: true, force: true });
});

test("a broken expression in the body or checklist is rejected", async () => {
  for (const [frontmatter, body] of [
    [validTemplate, "Practice on {{whoops}}.\n"],
    [validTemplate.replace("{{weekday+2d}}", "{{week:long}}"), "Practice notes.\n"],
  ] as const) {
    const root = await makeWorkspace();
    await writeTemplate(root, frontmatter, body);
    assert.ok(
      (await errorsFor(root)).some((error) => error.startsWith("E_INVALID_TEMPLATE_EXPRESSION")),
    );
    await rm(root, { recursive: true, force: true });
  }
});

test("a template due specification must match its mode", async () => {
  const cases = [
    "  due:\n    mode: whenever\n",
    "  due:\n    mode: offset\n",
    "  due:\n    mode: fixed\n",
    "  due:\n    mode: fixed\n    date: 2026-02-30\n",
    "  due:\n    mode: none\n    offset_days: 2\n",
    "  due:\n    mode: offset\n    offset_days: 1.5\n",
  ];
  for (const due of cases) {
    const root = await makeWorkspace();
    await writeTemplate(
      root,
      validTemplate.replace("  due:\n    mode: offset\n    offset_days: 2\n", due),
    );
    assert.ok(
      (await errorsFor(root)).some((error) => error.startsWith("E_INVALID_TEMPLATE_DUE")),
      `expected E_INVALID_TEMPLATE_DUE for ${JSON.stringify(due)}`,
    );
    await rm(root, { recursive: true, force: true });
  }
});

test("a template referencing a missing column or tag is rejected", async () => {
  for (const broken of [
    validTemplate.replace("column_inbox", "column_ghost"),
    validTemplate.replace("tag_music", "tag_ghost"),
  ]) {
    const root = await makeWorkspace();
    await writeTemplate(root, broken);
    assert.ok((await errorsFor(root)).some((error) => /^E_REF_(COLUMN|TAG)_NOT_FOUND/.test(error)));
    await rm(root, { recursive: true, force: true });
  }
});

test("a template checklist must be a list of strings", async () => {
  const root = await makeWorkspace();
  await writeTemplate(root, validTemplate.replace('  - "Scales for {{weekday+2d}}"', "  - 42"));
  assert.ok((await errorsFor(root)).some((error) => error.startsWith("E_INVALID_FIELD_TYPE")));
  await rm(root, { recursive: true, force: true });
});

test("create_card requires an existing template", async () => {
  const root = await makeWorkspace();
  await writeTemplate(root, validTemplate);
  await writeRule(root, validRule.replace("template_piano\n", "template_ghost\n"));
  assert.ok(
    (await errorsFor(root)).some((error) =>
      /^E_(INVALID_RULE_ACTION|REF_TEMPLATE_NOT_FOUND)/.test(error),
    ),
  );
  await rm(root, { recursive: true, force: true });
});

test("create_card requires a template_id", async () => {
  const root = await makeWorkspace();
  await writeTemplate(root, validTemplate);
  await writeRule(root, validRule.replace("    template_id: template_piano\n", ""));
  assert.ok((await errorsFor(root)).some((error) => error.startsWith("E_INVALID_RULE_ACTION")));
  await rm(root, { recursive: true, force: true });
});

test("create_card is rejected outside a schedule trigger", async () => {
  const root = await makeWorkspace();
  await writeTemplate(root, validTemplate);
  await writeRule(
    root,
    validRule.replace(
      `trigger:
  type: schedule
  every:
    days: 3
    anchor: 2026-08-19
    at: "08:00"`,
      `trigger:
  type: card_created`,
    ),
  );
  assert.ok((await errorsFor(root)).some((error) => error.startsWith("E_INVALID_RULE_ACTION")));
  await rm(root, { recursive: true, force: true });
});

test("create_card is rejected alongside conditions", async () => {
  const root = await makeWorkspace();
  await writeTemplate(root, validTemplate);
  await writeRule(
    root,
    validRule.replace(
      "actions:",
      `conditions:
  - type: completed
    value: false
actions:`,
    ),
  );
  assert.ok((await errorsFor(root)).some((error) => error.startsWith("E_INVALID_RULE_ACTION")));
  await rm(root, { recursive: true, force: true });
});

test("a schedule trigger takes exactly one of cron and every", async () => {
  const both = validRule.replace(
    `  every:
    days: 3
    anchor: 2026-08-19
    at: "08:00"`,
    `  cron: "0 8 * * *"
  every:
    days: 3
    anchor: 2026-08-19`,
  );
  const neither = validRule.replace(
    `  every:
    days: 3
    anchor: 2026-08-19
    at: "08:00"
`,
    "",
  );
  for (const rule of [both, neither]) {
    const root = await makeWorkspace();
    await writeTemplate(root, validTemplate);
    await writeRule(root, rule);
    assert.ok((await errorsFor(root)).some((error) => error.startsWith("E_INVALID_RULE_TRIGGER")));
    await rm(root, { recursive: true, force: true });
  }
});

test("an every schedule rejects malformed intervals, anchors, and times", async () => {
  const cases = [
    "  every:\n    days: 0\n    anchor: 2026-08-19\n",
    "  every:\n    days: 1.5\n    anchor: 2026-08-19\n",
    "  every:\n    anchor: 2026-08-19\n",
    "  every:\n    days: 1\n    weeks: 1\n    anchor: 2026-08-19\n",
    "  every:\n    days: 1\n    anchor: 19-08-2026\n",
    "  every:\n    days: 1\n    anchor: 2026-02-30\n",
    '  every:\n    days: 1\n    anchor: 2026-08-19\n    at: "25:00"\n',
  ];
  for (const every of cases) {
    const root = await makeWorkspace();
    await writeTemplate(root, validTemplate);
    await writeRule(
      root,
      validRule.replace('  every:\n    days: 3\n    anchor: 2026-08-19\n    at: "08:00"\n', every),
    );
    assert.ok(
      (await errorsFor(root)).some((error) => error.startsWith("E_INVALID_RULE_TRIGGER")),
      `expected E_INVALID_RULE_TRIGGER for ${JSON.stringify(every)}`,
    );
    await rm(root, { recursive: true, force: true });
  }
});

test("an existing cron schedule rule keeps validating", async () => {
  const root = await makeWorkspace();
  await writeRule(
    root,
    `
schema_version: 1
id: rule_piano
name: Nightly sort
enabled: true
trigger:
  type: schedule
  cron: "0 0 * * *"
actions:
  - type: sort_cards
    scope: all_columns
    by: due_at
    direction: ascending
    nulls: last
created_at: ${now}
updated_at: ${now}
`,
  );
  assert.deepEqual(await errorsFor(root), []);
  await rm(root, { recursive: true, force: true });
});

test("a card carrying an origin marker validates", async () => {
  const root = await makeWorkspace();
  await writeFile(
    join(root, "cards/card_piano.md"),
    `---
schema_version: 1
id: card_piano
title: Piano
column_id: column_inbox
previous_column_id: null
position: 1024
completed: false
completed_at: null
due_at: null
tag_ids: []
checklist_ids: []
comment_ids: []
origin:
  rule_id: rule_piano
  template_id: template_piano
  occurrence: 2026-08-22T08:00:00Z
created_at: ${now}
updated_at: ${now}
archived_at: null
---

Body.
`,
  );
  assert.deepEqual(await errorsFor(root), []);
  await rm(root, { recursive: true, force: true });
});

test("a malformed origin marker is rejected", async () => {
  for (const origin of [
    "origin: not-a-mapping",
    "origin:\n  rule_id: rule_piano\n  template_id: template_piano\n  occurrence: yesterday",
    "origin:\n  rule_id: nope\n  template_id: template_piano\n  occurrence: 2026-08-22T08:00:00Z",
    "origin:\n  template_id: template_piano\n  occurrence: 2026-08-22T08:00:00Z",
  ]) {
    const root = await makeWorkspace();
    await writeFile(
      join(root, "cards/card_piano.md"),
      `---
schema_version: 1
id: card_piano
title: Piano
column_id: column_inbox
previous_column_id: null
position: 1024
completed: false
completed_at: null
due_at: null
tag_ids: []
checklist_ids: []
comment_ids: []
${origin}
created_at: ${now}
updated_at: ${now}
archived_at: null
---

Body.
`,
    );
    assert.ok(
      (await errorsFor(root)).length > 0,
      `expected a diagnostic for ${JSON.stringify(origin)}`,
    );
    await rm(root, { recursive: true, force: true });
  }
});
