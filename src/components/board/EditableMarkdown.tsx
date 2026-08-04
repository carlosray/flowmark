import { useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  editableMarkdownKeyAction,
  resizeMarkdownEditor,
  resolveMarkdownEdit,
} from "@/lib/editable-markdown-state";
import { cn } from "@/lib/utils";
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
  previewClassName,
  editorClassName,
}: EditableMarkdownProps) {
  const initiallyEditing = editWhenEmpty && !value;
  const [editing, setEditing] = useState(initiallyEditing);
  const [draft, setDraft] = useState(value);
  const baselineRef = useRef(value);
  const editingRef = useRef(initiallyEditing);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editingRef.current) setDraft(value);
  }, [value]);

  useLayoutEffect(() => {
    if (editing && multiline && textareaRef.current) {
      resizeMarkdownEditor(textareaRef.current);
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

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const action = editableMarkdownKeyAction(event, multiline);
    if (!action) return;
    event.preventDefault();
    finishEditing(action === "cancel");
  }

  if (editing) {
    const sharedProps = {
      autoFocus: true,
      value: draft,
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        changeDraft(event.target.value),
      onBlur: () => finishEditing(false),
      onKeyDown,
      "aria-label": ariaLabel,
    };

    return multiline ? (
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
    );
  }

  const content = value ? (
    inline ? (
      <MarkdownInline>{value}</MarkdownInline>
    ) : (
      <MarkdownContent>{value}</MarkdownContent>
    )
  ) : (
    <span className="italic text-muted-foreground">{placeholder}</span>
  );

  return (
    <div
      onClick={(event) => {
        if (!(event.target as HTMLElement).closest("a")) beginEditing();
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
