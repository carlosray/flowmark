import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { THEMES, applyTheme, themeBootstrapScript, type ThemeId } from "../src/lib/themes.ts";

test("exposes exactly the eight concrete themes and never System", () => {
  assert.deepEqual(
    THEMES.map((theme) => theme.id),
    [
      "flow-neutral",
      "one-dark",
      "nord",
      "catppuccin-mocha",
      "tokyo-night",
      "gruvbox-dark",
      "solarized-light",
      "rose-pine",
    ],
  );
  assert.equal(
    THEMES.some((theme) => theme.label === "System"),
    false,
  );
});

test("applies theme identity and light or dark mode to the document root", () => {
  const attributes = new Map<string, string>();
  const classes = new Set<string>();
  const root = {
    setAttribute(name: string, value: string) {
      attributes.set(name, value);
    },
    classList: {
      toggle(name: string, force: boolean) {
        if (force) classes.add(name);
        else classes.delete(name);
      },
    },
  };

  applyTheme("nord", root);
  assert.equal(attributes.get("data-theme"), "nord");
  assert.equal(classes.has("dark"), true);

  applyTheme("solarized-light", root);
  assert.equal(attributes.get("data-theme"), "solarized-light");
  assert.equal(classes.has("dark"), false);
});

test("bootstrap script is deterministic, validated, and has no browser preference source", () => {
  const script = themeBootstrapScript("solarized-light");
  assert.match(script, /solarized-light/);
  assert.match(script, /data-theme/);
  assert.doesNotMatch(script, /localStorage|matchMedia|system/i);
  assert.throws(() => themeBootstrapScript("system" as ThemeId), /Invalid theme ID: system/);
});

test("root theme bootstrapping never reads browser storage", async () => {
  const source = await readFile(new URL("../src/routes/__root.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /localStorage|matchMedia/);
});

test("every theme defines the required semantic color groups", async () => {
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  for (const theme of THEMES) {
    const start = css.indexOf(`html[data-theme="${theme.id}"]`);
    assert.notEqual(start, -1, `missing CSS block for ${theme.id}`);
    const end = css.indexOf("\n}", start);
    const block = css.slice(start, end);
    for (const token of [
      "--background:",
      "--surface:",
      "--foreground:",
      "--border:",
      "--primary:",
      "--focus-ring:",
      "--success:",
      "--warning:",
      "--danger:",
      "--due-overdue:",
      "--due-today:",
      "--tag-blue:",
      "--tag-green:",
    ])
      assert.match(block, new RegExp(token), `${theme.id} is missing ${token}`);
  }
});
