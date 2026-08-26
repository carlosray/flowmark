import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { LayoutTemplate, Plus, X } from "lucide-react";

import { templatesStore, useTemplates, useTemplatesSync } from "@/lib/templates";
import { createTemplateId, emptyTemplate, templateDueLabel } from "@/lib/templates-ui";
import type { CardTemplate } from "@/lib/templates";
import { TemplateEditorModal } from "./TemplateEditorModal";

export function TemplatesButton() {
  const [open, setOpen] = useState(false);
  const templates = useTemplates();

  useEffect(() => {
    templatesStore.hydrate();
  }, []);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 h-8 text-xs bg-surface-sunken border border-border rounded-md px-2.5 hover:bg-accent"
        title="Card templates"
      >
        <LayoutTemplate
          size={12}
          className={templates.length > 0 ? "text-primary" : "text-muted-foreground"}
        />
        Templates
        {templates.length > 0 && (
          <span className="text-[10px] text-subtle-foreground">· {templates.length}</span>
        )}
      </button>
      {open && createPortal(<TemplatesModal onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function TemplatesModal({ onClose }: { onClose: () => void }) {
  const templates = useTemplates();
  const sync = useTemplatesSync();
  const [editing, setEditing] = useState<CardTemplate | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && editing === null) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editing, onClose]);

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm flex items-start justify-center p-6 overflow-y-auto"
        onClick={onClose}
      >
        <div
          className="w-full max-w-xl bg-popover border border-border rounded-xl shadow-2xl mt-8 mb-8"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border">
            <LayoutTemplate size={15} className="text-primary" />
            <h2 className="text-sm font-semibold">Card templates</h2>
            <span className="text-[11px] text-subtle-foreground">
              Cards a scheduled rule can create for you
            </span>
            <button
              onClick={onClose}
              aria-label="Close templates"
              className="ml-auto text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-accent"
            >
              <X size={14} />
            </button>
          </div>

          <div className="p-4 space-y-1.5 max-h-[70vh] overflow-y-auto">
            {templates.length === 0 && (
              <div className="text-center py-10 text-sm text-muted-foreground">
                No templates yet. Make one for something you do on a rhythm, then point a scheduled
                rule at it.
              </div>
            )}
            {templates.map((template) => (
              <button
                key={template.id}
                onClick={() => setEditing(template)}
                className="w-full text-left px-3 py-2 rounded-md border border-border bg-surface hover:bg-accent"
              >
                <div className="text-sm">{template.name}</div>
                <div className="text-[11px] text-subtle-foreground truncate">
                  {template.title || "No title yet"} · {templateDueLabel(template.due)}
                </div>
              </button>
            ))}
            <button
              onClick={() => setEditing(emptyTemplate(createTemplateId(), null))}
              className="w-full inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-3 py-2 rounded-md hover:bg-accent"
            >
              <Plus size={13} />
              New template
            </button>
          </div>

          <div className="border-t border-border px-4 py-3 flex items-center justify-between gap-3">
            <span
              className={`text-[11px] ${sync.status === "error" ? "text-danger" : "text-subtle-foreground"}`}
            >
              {sync.status === "error" ? `Error: ${sync.error}` : (sync.path ?? "")}
            </span>
          </div>
        </div>
      </div>
      {editing &&
        createPortal(
          <TemplateEditorModal
            key={editing.id}
            template={editing}
            locale={sync.locale}
            timeZone={sync.timeZone}
            onSave={(template) => templatesStore.upsert(template)}
            onDelete={(id) => templatesStore.remove(id)}
            onClose={() => setEditing(null)}
          />,
          document.body,
        )}
    </>
  );
}
