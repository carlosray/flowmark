import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";
import type { ComponentType } from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

async function exists(path: URL) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test("inline Markdown renders safe links without a paragraph wrapper", async () => {
  const markdown = (await import("../src/components/board/MarkdownContent.tsx")) as Record<
    string,
    unknown
  >;
  assert.equal(typeof markdown.MarkdownInline, "function");

  const MarkdownInline = markdown.MarkdownInline as ComponentType<{ children: string }>;
  const html = renderToStaticMarkup(
    createElement(MarkdownInline, { children: "Open [issue](https://example.com/42)" }),
  );

  assert.match(html, /href="https:\/\/example\.com\/42"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /<p>/);
});

test("editable Markdown resolves saves and cancellation from persisted content", async () => {
  const modulePath = new URL("../src/lib/editable-markdown-state.ts", import.meta.url);
  assert.equal(await exists(modulePath), true, "editable-markdown-state.ts must exist");
  const editable = (await import(modulePath.href)) as Record<string, unknown>;
  const resolveMarkdownEdit = editable.resolveMarkdownEdit as (
    original: string,
    draft: string,
    cancelled: boolean,
    normalize?: (value: string) => string,
  ) => { value: string; shouldSave: boolean };

  assert.deepEqual(resolveMarkdownEdit("Original", "Changed", true), {
    value: "Original",
    shouldSave: false,
  });
  assert.deepEqual(
    resolveMarkdownEdit("Original", "  Changed  ", false, (value) => value.trim()),
    {
      value: "Changed",
      shouldSave: true,
    },
  );
  assert.deepEqual(resolveMarkdownEdit("Original", "Original", false), {
    value: "Original",
    shouldSave: false,
  });
});

test("editable Markdown uses consistent single-line and multiline shortcuts", async () => {
  const modulePath = new URL("../src/lib/editable-markdown-state.ts", import.meta.url);
  assert.equal(await exists(modulePath), true, "editable-markdown-state.ts must exist");
  const editable = (await import(modulePath.href)) as Record<string, unknown>;
  const editableMarkdownKeyAction = editable.editableMarkdownKeyAction as (
    event: { key: string; metaKey: boolean; ctrlKey: boolean },
    multiline: boolean,
  ) => "save" | "cancel" | null;

  assert.equal(
    editableMarkdownKeyAction({ key: "Enter", metaKey: false, ctrlKey: false }, false),
    "save",
  );
  assert.equal(
    editableMarkdownKeyAction({ key: "Enter", metaKey: false, ctrlKey: false }, true),
    null,
  );
  assert.equal(
    editableMarkdownKeyAction({ key: "Enter", metaKey: true, ctrlKey: false }, true),
    "save",
  );
  assert.equal(
    editableMarkdownKeyAction({ key: "Enter", metaKey: false, ctrlKey: true }, true),
    "save",
  );
  assert.equal(
    editableMarkdownKeyAction({ key: "Escape", metaKey: false, ctrlKey: false }, true),
    "cancel",
  );
});

test("multiline Markdown editors grow to fit their content", async () => {
  const modulePath = new URL("../src/lib/editable-markdown-state.ts", import.meta.url);
  assert.equal(await exists(modulePath), true, "editable-markdown-state.ts must exist");
  const editable = (await import(modulePath.href)) as Record<string, unknown>;
  const resizeMarkdownEditor = editable.resizeMarkdownEditor as (editor: {
    scrollHeight: number;
    style: { height: string };
  }) => void;
  const editor = { scrollHeight: 420, style: { height: "180px" } };

  resizeMarkdownEditor(editor);

  assert.equal(editor.style.height, "420px");
});

test("editable Markdown defaults to an accessible rendered preview", async () => {
  const modulePath = new URL("../src/components/board/EditableMarkdown.tsx", import.meta.url);
  assert.equal(await exists(modulePath), true, "EditableMarkdown.tsx must exist");
  const editable = (await import(modulePath.href)) as Record<string, unknown>;
  const EditableMarkdown = editable.EditableMarkdown as ComponentType<{
    value: string;
    onSave: (value: string) => void;
    ariaLabel: string;
    inline?: boolean;
  }>;

  const html = renderToStaticMarkup(
    createElement(EditableMarkdown, {
      value: "Read [the issue](https://example.com/issue)",
      onSave: () => undefined,
      ariaLabel: "Edit card title",
      inline: true,
    }),
  );

  assert.match(html, /role="button"/);
  assert.match(html, /tabindex="0"/);
  assert.match(html, /aria-label="Edit card title"/);
  assert.match(html, /href="https:\/\/example\.com\/issue"/);
  assert.doesNotMatch(html, /<input|<textarea/);
});
