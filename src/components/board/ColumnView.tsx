import { useState } from "react";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import type { Column } from "@/lib/types";
import { store, useBoard } from "@/lib/store";
import { CardItem } from "./CardItem";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ColumnView({
  column,
  onOpenCard,
  cardFilter,
}: {
  column: Column;
  onOpenCard: (id: string) => void;
  cardFilter: (cardId: string) => boolean;
}) {
  const board = useBoard();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(column.name);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: column.id,
    data: { type: "column" },
  });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `col-${column.id}`,
    data: { type: "column-body", columnId: column.id },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const visibleCardIds = column.cardIds.filter(cardFilter);
  const cards = visibleCardIds.map((id) => board.cards[id]).filter(Boolean);

  const submit = () => {
    const v = title.trim();
    if (v) store.addCard(column.id, v);
    setTitle("");
    setAdding(false);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="ds-column shrink-0 w-[85vw] max-w-[300px] sm:w-[300px] flex flex-col h-full"
    >
      <div className="flex items-center gap-1 px-3 py-2.5 border-b border-border">
        <button
          className="text-muted-foreground/60 hover:text-muted-foreground cursor-grab active:cursor-grabbing"
          {...attributes}
          {...listeners}
          aria-label="Drag column"
        >
          <GripVertical size={14} />
        </button>
        {renaming ? (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              store.renameColumn(column.id, name.trim() || column.name);
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setName(column.name);
                setRenaming(false);
              }
            }}
            autoFocus
            className="flex-1 bg-surface border border-border rounded px-1.5 py-0.5 text-sm outline-none"
          />
        ) : (
          <button
            onClick={() => setRenaming(true)}
            className="flex-1 text-left text-sm font-semibold text-foreground/90"
          >
            {column.name}
          </button>
        )}
        <span className="text-[11px] text-muted-foreground font-mono">{cards.length}</span>
        <DropdownMenu>
          <DropdownMenuTrigger className="p-1 rounded hover:bg-accent text-muted-foreground">
            <MoreHorizontal size={14} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-popover">
            <DropdownMenuItem onClick={() => setRenaming(true)}>Rename</DropdownMenuItem>
            <DropdownMenuItem onClick={() => store.toggleCollapsed(column.id)}>
              {column.collapsed ? "Expand" : "Collapse"}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-danger"
              onClick={() => {
                if (column.cardIds.length > 0) {
                  alert("Move or archive every card before removing this column.");
                  return;
                }
                if (confirm(`Remove empty column "${column.name}"?`)) store.deleteColumn(column.id);
              }}
            >
              <Trash2 size={12} className="mr-1.5" /> Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {!column.collapsed && (
        <>
          <div
            ref={setDropRef}
            className={`flex-1 min-h-[40px] overflow-y-auto p-2 flex flex-col gap-2 transition-colors ${
              isOver ? "bg-primary/5" : ""
            }`}
          >
            <SortableContext items={visibleCardIds} strategy={verticalListSortingStrategy}>
              {cards.map((c) => (
                <CardItem key={c.id} card={c} onOpen={onOpenCard} />
              ))}
            </SortableContext>
            {cards.length === 0 && !adding && (
              <div className="text-[11px] text-subtle-foreground italic px-1 py-2">Empty</div>
            )}
          </div>

          <div className="p-2 border-t border-border">
            {adding ? (
              <div className="space-y-1.5">
                <textarea
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      submit();
                    }
                    if (e.key === "Escape") {
                      setAdding(false);
                      setTitle("");
                    }
                  }}
                  autoFocus
                  placeholder="Card title…"
                  rows={2}
                  className="w-full bg-surface border border-border rounded-md p-2 text-[13px] outline-none focus:border-primary/60 resize-none"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={submit}
                    className="bg-primary text-primary-foreground text-xs font-medium px-2.5 py-1 rounded-md hover:opacity-90"
                  >
                    Add card
                  </button>
                  <button
                    onClick={() => {
                      setAdding(false);
                      setTitle("");
                    }}
                    className="text-xs text-muted-foreground px-2 py-1 hover:text-foreground"
                  >
                    Cancel
                  </button>
                  <span className="ds-kbd ml-auto">↵</span>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="w-full flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded-md px-2 py-1.5 transition"
              >
                <Plus size={12} /> Add card
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
