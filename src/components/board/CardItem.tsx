import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CheckCircle2, MessageSquare, ListChecks, Square, CheckSquare } from "lucide-react";
import type { Card } from "@/lib/types";
import { useBoard, store } from "@/lib/store";
import { TagPill } from "./TagPill";
import { DueBadge } from "./DueBadge";
import { cn } from "@/lib/utils";
import { checklistExpansionStore, useChecklistExpanded } from "@/lib/checklist-expansion";
import { useRuleEffects } from "@/lib/rules";
import { ChecklistItemText } from "./ChecklistItemText";

export function CardItem({ card, onOpen }: { card: Card; onOpen: (id: string) => void }) {
  const { tags } = useBoard();
  const checklistOpen = useChecklistExpanded(card.id);
  const effect = useRuleEffects()[card.id];
  const movedByRule = effect?.kinds.includes("moved") ?? false;
  const dueDateChangedByRule = effect?.kinds.includes("due-date-changed") ?? false;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: "card", card },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    viewTransitionName: `flowmark-card-${card.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
  };

  const cardTags = card.tagIds
    .map((id) => tags.find((t) => t.id === id))
    .filter(Boolean) as typeof tags;

  const checklistDone = card.checklist.filter((i) => i.done).length;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(card.id)}
      className={cn(
        "ds-card ds-card-hover ds-fade-in p-2.5 cursor-pointer select-none group",
        card.completed && "opacity-60",
        movedByRule && "flowmark-rule-card-arrival",
      )}
    >
      {cardTags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {cardTags.map((t) => (
            <TagPill key={t.id} tag={t} />
          ))}
        </div>
      )}

      <div className="flex items-start">
        <div
          className={cn(
            "overflow-hidden transition-all duration-200 ease-out shrink-0",
            card.completed
              ? "w-5 opacity-100"
              : "w-0 opacity-0 group-hover:w-5 group-hover:opacity-100",
          )}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              store.toggleCompleted(card.id);
            }}
            className={cn(
              "mt-0.5 w-4 h-4 rounded-full border transition-colors flex items-center justify-center",
              card.completed
                ? "bg-success border-success text-primary-foreground"
                : "border-border-strong hover:border-primary",
            )}
            aria-label="Toggle complete"
          >
            {card.completed && <CheckCircle2 size={12} />}
          </button>
        </div>
        <div
          className={cn(
            "text-[13px] leading-snug font-medium flex-1 min-w-0 break-words",
            card.completed && "line-through text-muted-foreground",
          )}
        >
          {card.title}
        </div>
      </div>

      {(card.dueDate || card.checklist.length > 0 || card.comments.length > 0) && (
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {card.dueDate && (
            <span
              key={effect?.revision ?? 0}
              className={cn(dueDateChangedByRule && "flowmark-rule-due-pulse")}
            >
              <DueBadge iso={card.dueDate} />
            </span>
          )}
          {card.checklist.length > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                checklistExpansionStore.toggle(card.id);
              }}
              className={cn(
                "inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border border-border-strong hover:bg-primary/15 hover:border-primary hover:text-foreground cursor-pointer transition-colors",
                checklistDone === card.checklist.length ? "text-success" : "text-muted-foreground",
              )}
              aria-label="Toggle checklist"
              aria-expanded={checklistOpen}
            >
              <ListChecks size={12} />
              {checklistDone}/{card.checklist.length}
            </button>
          )}

          {card.comments.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <MessageSquare size={12} />
              {card.comments.length}
            </span>
          )}
        </div>
      )}

      {checklistOpen && card.checklist.length > 0 && (
        <ul className="mt-2 min-w-0 space-y-1 border-t border-border/60 pt-2">
          {card.checklist.map((item) => (
            <li key={item.id} className="flex min-w-0 items-start gap-2 rounded px-1 py-0.5">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  store.toggleChecklistItem(card.id, item.id);
                }}
                className="mt-0.5 shrink-0 rounded transition-colors hover:text-primary"
                aria-label={
                  item.done ? "Mark checklist item incomplete" : "Complete checklist item"
                }
              >
                {item.done ? (
                  <CheckSquare size={14} className="text-success" />
                ) : (
                  <Square size={14} className="text-muted-foreground" />
                )}
              </button>
              <ChecklistItemText text={item.text} done={item.done} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
