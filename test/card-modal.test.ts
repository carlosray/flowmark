import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildCardContentPatch,
  hasMoreScrollableContent,
  saveCardContentBeforeClose,
} from "../src/lib/card-modal-state.ts";

test("closing a card commits the latest title and description together", () => {
  assert.deepEqual(
    buildCardContentPatch(
      { title: "Old title", description: "Old description" },
      "  New title  ",
      "New description",
    ),
    { title: "New title", description: "New description" },
  );
});

test("closing an unchanged card does not trigger a write", () => {
  assert.deepEqual(
    buildCardContentPatch(
      { title: "Existing title", description: "Existing description" },
      "Existing title",
      "Existing description",
    ),
    {},
  );
});

test("blank card titles are saved as Untitled", () => {
  assert.deepEqual(buildCardContentPatch({ title: "Existing title", description: "" }, "   ", ""), {
    title: "Untitled",
  });
});

test("overflow cue remains visible until the scroll area reaches the bottom", () => {
  assert.equal(
    hasMoreScrollableContent({
      scrollHeight: 900,
      clientHeight: 500,
      scrollTop: 0,
    }),
    true,
  );
  assert.equal(
    hasMoreScrollableContent({
      scrollHeight: 900,
      clientHeight: 500,
      scrollTop: 396,
    }),
    false,
  );
  assert.equal(
    hasMoreScrollableContent({
      scrollHeight: 500,
      clientHeight: 500,
      scrollTop: 0,
    }),
    false,
  );
});

test("card footer fills the modal and uses normal bottom padding", async () => {
  const source = await readFile(
    new URL("../src/components/board/CardModal.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /className="flex min-h-full flex-col gap-5 p-4 sm:p-6"/);
  assert.match(source, /className="mt-auto pt-2 border-t border-border/);
});

test("card editor dialog has an accessible description", async () => {
  const source = await readFile(
    new URL("../src/components/board/CardModal.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /<DialogDescription className="sr-only">/);
});

test("the card editor holds automation until it unmounts", async () => {
  const source = await readFile(
    new URL("../src/components/board/CardModal.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /rulesStore\.holdCard\(card\.id\)/);
  assert.match(source, /return \(\) => rulesStore\.releaseCard\(card\.id\)/);
});

test("title, description, and comments use the same preview-to-edit Markdown component", async () => {
  const source = await readFile(
    new URL("../src/components/board/CardModal.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /import ReactMarkdown/);
  assert.match(source, /import \{ EditableMarkdown \} from "\.\/EditableMarkdown"/);
  assert.equal(source.match(/<EditableMarkdown/g)?.length, 3);
  assert.match(source, /value=\{title\}[\s\S]*inline[\s\S]*ariaLabel="Edit card title"/);
  assert.match(source, /value=\{desc\}[\s\S]*multiline[\s\S]*editWhenEmpty/);
  assert.match(source, /value=\{c\.body\}[\s\S]*multiline/);
  assert.match(source, /store\.updateComment\(card\.id, c\.id, body\)/);
});

test("the shared Markdown surface has visible themed typography", async () => {
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

  for (const selector of [
    ".prose-flow h1",
    ".prose-flow ul",
    ".prose-flow blockquote",
    ".prose-flow pre",
    ".prose-flow table",
  ]) {
    assert.equal(styles.includes(selector), true, `missing Markdown style: ${selector}`);
  }
});

test("rule-driven card moves and due dates expose themed motion feedback", async () => {
  const cardSource = await readFile(
    new URL("../src/components/board/CardItem.tsx", import.meta.url),
    "utf8",
  );
  const ruleSource = await readFile(new URL("../src/lib/rules.ts", import.meta.url), "utf8");
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

  assert.match(cardSource, /useRuleEffects/);
  assert.match(cardSource, /viewTransitionName/);
  assert.match(cardSource, /flowmark-rule-card-arrival/);
  assert.match(cardSource, /flowmark-rule-due-pulse/);
  assert.match(cardSource, /key=\{effect\?\.revision/);
  assert.match(ruleSource, /startViewTransition/);
  assert.match(ruleSource, /flushSync/);
  assert.match(styles, /@keyframes flowmark-rule-card-arrival/);
  assert.match(styles, /@keyframes flowmark-rule-due-pulse/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /\.flowmark-rule-card-arrival/);
  assert.match(styles, /\.flowmark-rule-due-pulse/);
});

test("card close updates and flushes the filesystem before closing", async () => {
  const calls: string[] = [];

  await saveCardContentBeforeClose({
    card: { id: "card_test", title: "Old", description: "Old body" },
    title: "New",
    description: "New body",
    updateCard: (id, patch) => {
      calls.push(`update:${id}:${patch.title}:${patch.description}`);
    },
    flushPendingSave: async () => {
      calls.push("flush");
    },
    onClose: () => {
      calls.push("close");
    },
  });

  assert.deepEqual(calls, ["update:card_test:New:New body", "flush", "close"]);
});

test("card close flushes pending blur edits even when its patch is unchanged", async () => {
  const calls: string[] = [];

  await saveCardContentBeforeClose({
    card: { id: "card_test", title: "Same", description: "Same body" },
    title: "Same",
    description: "Same body",
    updateCard: () => calls.push("update"),
    flushPendingSave: async () => {
      calls.push("flush");
    },
    onClose: () => calls.push("close"),
  });

  assert.deepEqual(calls, ["flush", "close"]);
});
