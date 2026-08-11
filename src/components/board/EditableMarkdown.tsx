import { useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  editableMarkdownKeyAction,
  resizeMarkdownEditor,
  resolveMarkdownEdit,
} from "@/lib/editable-markdown-state";
import { applyCardMention, findCardMentionQuery, rankCardMentions } from "@/lib/card-mentions";
import { useBoard } from "@/lib/store";
import type { Card } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CardMentionMenu } from "./CardLink";
import { MarkdownContent, MarkdownInline } from "./MarkdownContent";

export interface EditableMarkdownProps {
  value: string;
  onSave: (value: string) => void;
  onDraftChange?: (value: string) => void;
  normalizeValue?: (value: string) => string;
  ariaLabel: string;
  placeholder?: string;
  inline?: boolean;
  multiline?: boolean;
  editWhenEmpty?: boolean;
  /** Render `flowmark://card_<id>` references as titled card links. */
  cardLinks?: boolean;
  /** Autocomplete `flowmark:<query>` with cards while editing. */
  cardMentions?: boolean;
  previewClassName?: string;
  editorClassName?: string;
}

export function EditableMarkdown({
  value,
  onSave,
  onDraftChange,
  normalizeValue,
  ariaLabel,
  placeholder = "Add content…",
  inline = false,
  multiline = false,
  editWhenEmpty = false,
  cardLinks = false,
  cardMentions = false,
  previewClassName,
  editorClassName,
}: EditableMarkdownProps) {
  const initiallyEditing = editWhenEmpty && !value;
  const [editing, setEditing] = useState(initiallyEditing);
  const [draft, setDraft] = useState(value);
  const baselineRef = useRef(value);
  const editingRef = useRef(initiallyEditing);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [highlight, setHighlight] = useState(0);
  const pendingCaretRef = useRef<number | null>(null);
  const board = useBoard();

  const suggestions =
    cardMentions && editing && mention
      ? rankCardMentions(Object.values(board.cards), mention.query)
      : [];

  useEffect(() => {
    if (!editingRef.current) setDraft(value);
  }, [value]);

  useLayoutEffect(() => {
    const editor = textareaRef.current;
    if (editing && multiline && editor) {
      resizeMarkdownEditor(editor);
      if (pendingCaretRef.current !== null) {
        editor.setSelectionRange(pendingCaretRef.current, pendingCaretRef.current);
        pendingCaretRef.current = null;
      }
    }
  }, [draft, editing, multiline]);

  function beginEditing() {
    baselineRef.current = value;
    setDraft(value);
    editingRef.current = true;
    setEditing(true);
  }

  function finishEditing(cancelled: boolean) {
    if (!editingRef.current) return;
    editingRef.current = false;
    setMention(null);
    const result = resolveMarkdownEdit(baselineRef.current, draft, cancelled, normalizeValue);
    setDraft(result.value);
    onDraftChange?.(result.value);
    setEditing(false);
    if (result.shouldSave) onSave(result.value);
  }

  function changeDraft(next: string) {
    setDraft(next);
    onDraftChange?.(next);
  }

  function syncMention() {
    if (!cardMentions) return;
    const editor = textareaRef.current;
    if (!editor) return;
    const found = findCardMentionQuery(editor.value, editor.selectionStart ?? editor.value.length);
    setMention(found);
    setHighlight(0);
  }

  function insertMention(card: Card) {
    const editor = textareaRef.current;
    if (!editor || !mention) return;
    const caret = editor.selectionStart ?? editor.value.length;
    const result = applyCardMention(editor.value, caret, mention.start, card.id);
    pendingCaretRef.current = result.caret;
    setMention(null);
    changeDraft(result.text);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (cardMentions && mention) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (suggestions.length > 0) {
          event.preventDefault();
          const delta = event.key === "ArrowDown" ? 1 : -1;
          setHighlight((current) => (current + delta + suggestions.length) % suggestions.length);
        }
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        if (suggestions.length > 0) {
          event.preventDefault();
          insertMention(suggestions[Math.min(highlight, suggestions.length - 1)]);
          return;
        }
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMention(null);
        return;
      }
    }
    const action = editableMarkdownKeyAction(event, multiline);
    if (!action) return;
    event.preventDefault();
    finishEditing(action === "cancel");
  }

  if (editing) {
    const sharedProps = {
      autoFocus: true,
      value: draft,
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        changeDraft(event.target.value);
        // The caret lands right after the changed text.
        queueMicrotask(syncMention);
      },
      onSelect: syncMention,
      onBlur: () => finishEditing(false),
      onKeyDown,
      "aria-label": ariaLabel,
    };

    return (
      <div className={cn(cardMentions && "relative")}>
        {multiline ? (
          <textarea
            {...sharedProps}
            ref={textareaRef}
            rows={4}
            className={cn(
              "w-full resize-none overflow-hidden rounded-md border border-border bg-surface-sunken p-3 font-mono text-[13px] outline-none focus:border-primary/60",
              editorClassName,
            )}
          />
        ) : (
          <input
            {...sharedProps}
            className={cn(
              "w-full border-b border-primary/40 bg-transparent pb-1 outline-none",
              editorClassName,
            )}
          />
        )}
        {cardMentions && (
          <CardMentionMenu
            suggestions={suggestions}
            highlight={Math.min(highlight, Math.max(0, suggestions.length - 1))}
            onHighlight={setHighlight}
            onPick={insertMention}
          />
        )}
      </div>
    );
  }

  const content = value ? (
    inline ? (
      <MarkdownInline>{value}</MarkdownInline>
    ) : (
      <MarkdownContent cardLinks={cardLinks}>{value}</MarkdownContent>
    )
  ) : (
    <span className="italic text-muted-foreground">{placeholder}</span>
  );

  return (
    <div
      onClick={(event) => {
        if (!(event.target as HTMLElement).closest("a,button")) beginEditing();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          beginEditing();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      className={cn("cursor-text", previewClassName)}
    >
      {content}
    </div>
  );
}
