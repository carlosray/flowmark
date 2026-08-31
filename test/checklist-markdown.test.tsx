import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ChecklistItemText,
  resolveChecklistEdit,
} from "../src/components/board/ChecklistItemText.tsx";

function render(text: string, done = false) {
  return renderToStaticMarkup(<ChecklistItemText text={text} done={done} />);
}

test("checklist text renders Markdown and bare links with the shared safe link treatment", () => {
  const html = render("Read [the guide](https://example.com/guide) or https://example.org.");

  assert.match(html, /href="https:\/\/example\.com\/guide"/);
  assert.match(html, /href="https:\/\/example\.org"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /text-primary/);
  assert.match(html, /prose-flow-checklist/);
  assert.match(html, /min-w-0/);
  assert.match(html, /max-w-full/);
});

test("completed checklist Markdown retains completed styling", () => {
  const html = render("Review **important** notes", true);

  assert.match(html, /<strong>important<\/strong>/);
  assert.match(html, /line-through/);
  assert.match(html, /text-muted-foreground/);
});

test("editable checklist Markdown is keyboard reachable and empty text keeps an edit target", () => {
  const editable = renderToStaticMarkup(
    <ChecklistItemText text="" done={false} editable onSave={() => {}} />,
  );

  assert.match(editable, /role="button"/);
  assert.match(editable, /tabindex="0"/);
  assert.match(editable, /aria-label="Edit checklist item/);
  assert.match(editable, /Add item text/);
});

test("checklist editing commits raw Markdown or restores the original on Escape", () => {
  assert.deepEqual(resolveChecklistEdit("old", "**new**", false), {
    value: "**new**",
    shouldSave: true,
  });
  assert.deepEqual(resolveChecklistEdit("old", "**new**", true), {
    value: "old",
    shouldSave: false,
  });
});

test("board checklist completion and Markdown text are separate interactive surfaces", async () => {
  const source = await readFile(
    new URL("../src/components/board/CardItem.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /<ChecklistItemText text=\{item\.text\} done=\{item\.done\}/);
  assert.doesNotMatch(source, /<span[^>]*>\s*\{item\.text\}/);
});

test("modal checklist renders Markdown by default and delegates explicit saves", async () => {
  const source = await readFile(
    new URL("../src/components/board/CardModal.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /<ChecklistItemText/);
  assert.match(source, /text=\{item\.text\}/);
  assert.match(source, /editable/);
  assert.match(
    source,
    /onSave=\{\(text\) => store\.updateChecklistItem\(cardId, item\.id, text\)\}/,
  );
  assert.match(source, /aria-label=\{item\.done \? "Mark checklist item incomplete"/);
  assert.doesNotMatch(source, /<input\s+value=\{item\.text\}/);
});

test("modal checklist rows expose handle-only animated sorting", async () => {
  const source = await readFile(
    new URL("../src/components/board/CardModal.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /<DndContext[\s\S]*?<SortableContext/);
  assert.match(source, /strategy=\{verticalListSortingStrategy\}/);
  assert.match(source, /function SortableChecklistRow/);
  assert.match(source, /useSortable\(\{ id: item\.id \}\)/);
  assert.match(source, /CSS\.Transform\.toString\(transform\)/);
  assert.match(source, /style=\{\{ transform: CSS\.Transform\.toString\(transform\), transition/);
  assert.match(source, /group\/checklist-row/);
  assert.match(source, /group-hover\/checklist-row:w-5/);
  assert.match(source, /group-focus-within\/checklist-row:w-5/);
  assert.match(source, /aria-label=\{`Reorder checklist item:/);
  assert.match(
    source,
    /ref=\{setActivatorNodeRef\}[\s\S]*?\{\.\.\.attributes\}[\s\S]*?\{\.\.\.listeners\}/,
  );
  assert.match(source, /<DragOverlay[\s\S]*?<ChecklistDragOverlay/);
});

test("checklist prose contains long content inside cards and modal rows", async () => {
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

  assert.match(styles, /\.prose-flow-checklist/);
  assert.match(styles, /overflow-wrap:\s*anywhere/);
  assert.match(styles, /word-break:\s*break-word/);
  assert.match(styles, /\.prose-flow-checklist pre/);
  assert.match(styles, /max-width:\s*100%/);
});
