import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "yaml";

import {
  COMPONENT_FIELDS,
  COMPONENT_NAMES,
  formatComponentSchemas,
  getComponentSchema,
} from "../src/lib/workspace/schema-catalog.ts";

test("publishes every authoritative Flowmark component schema", () => {
  assert.deepEqual(COMPONENT_NAMES, [
    "workspace",
    "card",
    "column",
    "tag",
    "rule",
    "comment",
    "checklist",
    "template",
  ]);

  for (const component of COMPONENT_NAMES) {
    const schema = getComponentSchema(component);
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
    assert.equal(schema.type, "object");
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.properties.schema_version, { const: 1 });
    assert.ok(schema.required.includes("schema_version"));
    assert.match(schema["x-flowmark-file"].filename_pattern, /^\^/);
    assert.deepEqual(
      Object.keys(schema.properties).sort(),
      [...COMPONENT_FIELDS[component]].sort(),
    );
  }
});

test("Markdown component schemas describe their body contract", () => {
  const card = getComponentSchema("card");
  const comment = getComponentSchema("comment");
  const column = getComponentSchema("column");

  assert.equal(card["x-flowmark-file"].format, "markdown-with-yaml-frontmatter");
  assert.deepEqual(card["x-flowmark-markdown-body"], { required: false });
  assert.equal(comment["x-flowmark-file"].format, "markdown-with-yaml-frontmatter");
  assert.deepEqual(comment["x-flowmark-markdown-body"], { required: true, min_length: 1 });
  assert.equal(column["x-flowmark-markdown-body"], undefined);
});

test("schema output is deterministic YAML by default and JSON on request", () => {
  const yamlA = formatComponentSchemas(["rule"], "yaml");
  const yamlB = formatComponentSchemas(["rule"], "yaml");
  assert.equal(yamlA, yamlB);
  assert.equal((parse(yamlA) as { component: string }).component, "rule");

  const json = formatComponentSchemas(["card", "rule"], "json");
  const parsed = JSON.parse(json) as { schemas: Record<string, unknown> };
  assert.deepEqual(Object.keys(parsed.schemas), ["card", "rule"]);
  assert.equal(json.endsWith("\n"), true);
});

test("rejects unknown component schema names", () => {
  assert.throws(() => getComponentSchema("board"), /Unknown component schema: board/);
});

test("every schema declares its version, authoritative file contract, and required fields", () => {
  for (const component of COMPONENT_NAMES) {
    const schema = getComponentSchema(component);
    assert.equal(schema.additionalProperties, false, component);
    assert.equal(schema["x-flowmark-file"].authoritative, true, component);
    assert.deepEqual(schema.properties.schema_version, { const: 1 }, component);
    for (const field of schema.required) {
      assert.ok(field in schema.properties, `${component}.${field} must have a property schema`);
    }
  }
});
