import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ThemeOptions, ThemeSwitcher } from "../src/components/board/ThemeSwitcher.tsx";
import { persistThemeSelection } from "../src/lib/theme-selection.ts";

test("theme options render all concrete themes and never System", () => {
  const html = renderToStaticMarkup(
    <ThemeOptions current="flow-neutral" error={null} onSelect={() => {}} />,
  );

  for (const label of [
    "Flow Neutral",
    "One Dark",
    "Nord",
    "Catppuccin Mocha",
    "Tokyo Night",
    "Gruvbox Dark",
    "Solarized Light",
    "Rosé Pine",
  ])
    assert.match(html, new RegExp(label));
  assert.doesNotMatch(html, />System</);
});

test("theme options expose persistence failures accessibly", () => {
  const html = renderToStaticMarkup(
    <ThemeOptions current="nord" error="Could not save the selected theme." onSelect={() => {}} />,
  );
  assert.match(html, /role="alert"/);
  assert.match(html, /Could not save the selected theme/);
});

test("switcher renders the server-provided workspace theme during SSR", () => {
  const html = renderToStaticMarkup(<ThemeSwitcher initialTheme="solarized-light" />);
  assert.match(html, /Solarized Light/);
  assert.doesNotMatch(html, /Flow Neutral/);
});

test("successful selection applies immediately and persists", async () => {
  const calls: string[] = [];
  const result = await persistThemeSelection({
    previous: "flow-neutral",
    next: "nord",
    apply: (theme) => calls.push(`apply:${theme}`),
    save: async (theme) => {
      calls.push(`save:${theme}`);
    },
  });

  assert.deepEqual(calls, ["apply:nord", "save:nord"]);
  assert.deepEqual(result, { theme: "nord", error: null });
});

test("failed selection restores the previous canonical theme", async () => {
  const calls: string[] = [];
  const result = await persistThemeSelection({
    previous: "flow-neutral",
    next: "nord",
    apply: (theme) => calls.push(`apply:${theme}`),
    save: async (theme) => {
      calls.push(`save:${theme}`);
      throw new Error("disk unavailable");
    },
  });

  assert.deepEqual(calls, ["apply:nord", "save:nord", "apply:flow-neutral"]);
  assert.deepEqual(result, {
    theme: "flow-neutral",
    error: "Could not save theme: disk unavailable",
  });
});

test("board toolbar uses the imported FlowMark icon and theme switcher", async () => {
  const boardSource = await readFile(
    new URL("../src/components/board/Board.tsx", import.meta.url),
    "utf8",
  );
  assert.match(boardSource, /flowmark-icon\.png/);
  assert.match(boardSource, /<ThemeSwitcher initialTheme=\{initialTheme\} \/>/);
  assert.match(boardSource, />FlowMark<\/span>/);

  const icon = await readFile(new URL("../src/assets/flowmark-icon.png", import.meta.url));
  assert.equal(
    createHash("sha1").update(icon).digest("hex"),
    "64610c2c847bcde0e668ffb07eccedbb0d7908be",
  );
});
