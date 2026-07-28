import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { MarkdownContent } from "./MarkdownContent";

export interface ChecklistItemTextProps {
  text: string;
  done: boolean;
  editable?: boolean;
  onSave?: (text: string) => void;
}

export function resolveChecklistEdit(original: string, draft: string, cancelled: boolean) {
  return cancelled
    ? { value: original, shouldSave: false }
    : { value: draft, shouldSave: draft !== original };
}

export function ChecklistItemText({
  text,
  done,
  editable = false,
  onSave,
}: ChecklistItemTextProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const editingRef = useRef(false);

  useEffect(() => {
    if (!editingRef.current) setDraft(text);
  }, [text]);

  function beginEditing() {
    if (!editable) return;
    setDraft(text);
    editingRef.current = true;
    setEditing(true);
  }

  function finishEditing(cancelled: boolean) {
    if (!editingRef.current) return;
    editingRef.current = false;
    const result = resolveChecklistEdit(text, draft, cancelled);
    setDraft(result.value);
    setEditing(false);
    if (result.shouldSave) onSave?.(result.value);
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => finishEditing(false)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            finishEditing(false);
          } else if (event.key === "Escape") {
            event.preventDefault();
            finishEditing(true);
          }
        }}
        aria-label="Edit checklist item"
        className={cn(
          "min-w-0 flex-1 border-b border-border bg-transparent py-0.5 text-sm outline-none focus:border-primary",
          done && "text-muted-foreground line-through",
        )}
      />
    );
  }

  return (
    <div
      onClick={(event) => {
        if (!(event.target as HTMLElement).closest("a")) beginEditing();
      }}
      onKeyDown={(event) => {
        if (editable && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          beginEditing();
        }
      }}
      role={editable ? "button" : undefined}
      tabIndex={editable ? 0 : undefined}
      aria-label={editable ? `Edit checklist item: ${text || "empty item"}` : undefined}
      className={cn(
        "prose-flow prose-flow-checklist min-w-0 max-w-full flex-1 overflow-hidden text-sm",
        editable && "cursor-text rounded px-1 py-0.5 hover:bg-surface-hover",
        done && "text-muted-foreground line-through",
      )}
    >
      {text ? (
        <MarkdownContent>{text}</MarkdownContent>
      ) : (
        <span className="italic text-muted-foreground">Add item text…</span>
      )}
    </div>
  );
}
