import { useEffect, useMemo, useState } from "react";
import { CheckSquare, Columns3, Plus, Trash2, X } from "lucide-react";

import { useBoard } from "@/lib/store";
import { templateIssues, templatePreview } from "@/lib/templates-ui";
import type { CardTemplate } from "@/lib/templates";
import type { ExpressionContext } from "@/lib/template-expression";
import { EditableMarkdown } from "./EditableMarkdown";
import { TagPill } from "./TagPill";
import { TemplateDuePicker } from "./TemplateDuePicker";
import { TemplateVariablesPanel } from "./TemplateVariablesPanel";

/**
 * Shaped like a card on purpose: a template is a card that has not happened
 * yet, so the same layout carries over, minus comments and completion.
 */
export function TemplateEditorModal({
  template,
  locale,
  timeZone,
  onSave,
  onDelete,
  onClose,
}: {
  template: CardTemplate;
  locale: string;
  timeZone: string;
  onSave: (template: CardTemplate) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const board = useBoard();
  const [draft, setDraft] = useState(template);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [newItem, setNewItem] = useState("");

  const patch = (changes: Partial<CardTemplate>) =>
    setDraft((current) => ({ ...current, ...changes }));

  const context: ExpressionContext = useMemo(() => {
    const occurrence = new Date();
    return { occurrence, dueDate: null, timeZone, locale };
  }, [locale, timeZone]);

  const issues = templateIssues(draft);
  const preview = templatePreview(draft, context);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function save() {
    if (issues.length > 0) return;
    setSaveError(null);
    const saved = await onSave(draft);
    if (saved) onClose();
    else setSaveError("The workspace refused the change. Check the template and try again.");
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm flex items-start justify-center p-6 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-popover border border-border rounded-xl shadow-2xl mt-8 mb-8"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border">
          <input
            aria-label="Template name"
            value={draft.name}
            onChange={(event) => patch({ name: event.target.value })}
            className="text-sm font-semibold bg-transparent outline-none flex-1 min-w-0"
          />
          <button
            onClick={onClose}
            aria-label="Close template"
            className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-accent"
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
          <div>
            <label className="text-[11px] font-medium text-muted-foreground">Card title</label>
            <input
              aria-label="Card title template"
              value={draft.title}
              onChange={(event) => patch({ title: event.target.value })}
              placeholder="Piano · {{date+2d:long}}"
              className="mt-1 w-full text-sm bg-surface border border-border rounded-md px-2.5 py-1.5 outline-none focus:border-primary/60"
            />
            {preview.title && (
              <p className="mt-1 text-[11px] text-subtle-foreground">
                Right now: <span className="text-foreground/80">{preview.title}</span>
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <TemplateDuePicker due={draft.due} onChange={(due) => patch({ due })} />
            <select
              aria-label="Target column"
              value={draft.columnId ?? ""}
              onChange={(event) => patch({ columnId: event.target.value || null })}
              className="text-xs bg-surface border border-border rounded-md px-2 py-1 text-foreground/90 outline-none focus:border-primary/60 cursor-pointer"
            >
              <option value="" className="bg-popover">
                Default column
              </option>
              {board.columns.map((column) => (
                <option key={column.id} value={column.id} className="bg-popover">
                  {column.name}
                </option>
              ))}
            </select>
            <Columns3 size={13} className="text-subtle-foreground" />
          </div>

          {board.tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {board.tags.map((tag) => {
                const active = draft.tagIds.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    aria-label={`${active ? "Remove" : "Add"} tag ${tag.name}`}
                    onClick={() =>
                      patch({
                        tagIds: active
                          ? draft.tagIds.filter((id) => id !== tag.id)
                          : [...draft.tagIds, tag.id],
                      })
                    }
                    className={active ? "" : "opacity-40 hover:opacity-80"}
                  >
                    <TagPill tag={tag} interactive />
                  </button>
                );
              })}
            </div>
          )}

          <div>
            <label className="text-[11px] font-medium text-muted-foreground">Description</label>
            <div className="mt-1">
              <EditableMarkdown
                value={draft.body}
                ariaLabel="Template description"
                multiline
                editWhenEmpty
                onSave={(body) => patch({ body })}
                onDraftChange={(body) => patch({ body })}
                placeholder="What this card should say. Expressions work here too."
              />
            </div>
          </div>

          <div>
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground mb-2">
              <CheckSquare size={13} />
              Checklist
            </div>
            <div className="space-y-1">
              {draft.checklist.map((item, index) => (
                <div key={index} className="flex items-center gap-1.5">
                  <input
                    aria-label={`Checklist item ${index + 1}`}
                    value={item}
                    onChange={(event) =>
                      patch({
                        checklist: draft.checklist.map((current, position) =>
                          position === index ? event.target.value : current,
                        ),
                      })
                    }
                    className="flex-1 text-sm bg-surface border border-border rounded-md px-2 py-1 outline-none focus:border-primary/60"
                  />
                  <button
                    aria-label={`Remove checklist item ${index + 1}`}
                    onClick={() =>
                      patch({
                        checklist: draft.checklist.filter((_, position) => position !== index),
                      })
                    }
                    className="text-muted-foreground hover:text-danger p-1 rounded-md hover:bg-accent"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-1.5">
                <input
                  aria-label="New checklist item"
                  value={newItem}
                  placeholder="Add an item"
                  onChange={(event) => setNewItem(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || newItem.trim() === "") return;
                    patch({ checklist: [...draft.checklist, newItem.trim()] });
                    setNewItem("");
                  }}
                  className="flex-1 text-sm bg-surface border border-border rounded-md px-2 py-1 outline-none focus:border-primary/60"
                />
                <button
                  aria-label="Add checklist item"
                  onClick={() => {
                    if (newItem.trim() === "") return;
                    patch({ checklist: [...draft.checklist, newItem.trim()] });
                    setNewItem("");
                  }}
                  className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-accent"
                >
                  <Plus size={13} />
                </button>
              </div>
            </div>
          </div>

          <TemplateVariablesPanel context={context} />
        </div>

        <div className="border-t border-border px-4 py-3 flex items-center justify-between gap-3">
          <span className="text-[11px] text-danger">{saveError ?? issues[0] ?? ""}</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void onDelete(draft.id).then(onClose)}
              className="text-xs text-muted-foreground hover:text-danger px-2 py-1 rounded-md hover:bg-accent"
            >
              Delete
            </button>
            <button
              onClick={() => void save()}
              disabled={issues.length > 0}
              className="text-xs bg-primary text-primary-foreground rounded-md px-3 py-1.5 disabled:opacity-40"
            >
              Save template
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
