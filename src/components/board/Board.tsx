import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragCancelEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";

import { Plus, Search, RotateCcw, Check } from "lucide-react";
import { store, useBoard, useBoardSync } from "@/lib/store";
import { rulesStore } from "@/lib/rules";
import { ColumnView } from "./ColumnView";
import { CardModal } from "./CardModal";
import { ManageTagsButton } from "./TagPicker";
import { RulesButton } from "./RulesButton";
import { ThemeSwitcher } from "./ThemeSwitcher";
import flowmarkIcon from "@/assets/flowmark-icon.png";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

import type { Card } from "@/lib/types";
import { dueState } from "@/lib/due";
import type { ThemeId } from "@/lib/themes";
import { checklistExpansionStore } from "@/lib/checklist-expansion";
import { matchesTagFilter } from "@/lib/board-filters";
import { reloadWithMinimumFeedback } from "@/lib/reload-feedback";
import { MarkdownInline } from "./MarkdownContent";

import { cn } from "@/lib/utils";

type DueFilter = "all" | "overdue" | "today" | "week" | "none";

type CompletedFilter = "all" | "open" | "done";

export function Board({
  initialTheme,
  initialExpandedChecklistCardIds,
}: {
  initialTheme: ThemeId;
  initialExpandedChecklistCardIds: string[];
}) {
  const board = useBoard();
  const sync = useBoardSync();
  const initialExpandedChecklistCardIdsRef = useRef(initialExpandedChecklistCardIds);

  useEffect(() => {
    checklistExpansionStore.hydrate(initialExpandedChecklistCardIdsRef.current);
    store.hydrate();
    rulesStore.hydrate();
  }, []);

  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [activeColumnId, setActiveColumnId] = useState<string | null>(null);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [draftCardId, setDraftCardId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [dueFilter, setDueFilter] = useState<DueFilter>("all");
  const [completedFilter, setCompletedFilter] = useState<CompletedFilter>("all");

  const searchRef = useRef<HTMLInputElement>(null);
  const cardDragOriginRef = useRef<{ cardId: string; columnId: string } | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      const editing = t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable;
      if (e.key === "/" && !editing) {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape" && document.activeElement === searchRef.current) {
        searchRef.current?.blur();
      }
      if (e.key === "n" && !editing) {
        e.preventDefault();
        if (board.columns.length > 0) setPickerOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [board.columns]);

  const filterCard = useMemo(() => {
    return (cardId: string): boolean => {
      const c: Card | undefined = board.cards[cardId];
      if (!c) return false;
      if (query) {
        const q = query.toLowerCase();
        const matches =
          c.title.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q) ||
          c.checklist.some((i) => i.text.toLowerCase().includes(q)) ||
          c.comments.some((m) => m.body.toLowerCase().includes(q));
        if (!matches) return false;
      }
      if (tagFilter.length > 0) {
        if (!matchesTagFilter(c.tagIds, tagFilter)) return false;
      }
      if (completedFilter === "open" && c.completed) return false;
      if (completedFilter === "done" && !c.completed) return false;
      if (dueFilter !== "all") {
        const s = dueState(c.dueDate);
        if (dueFilter === "overdue" && s !== "overdue") return false;
        if (dueFilter === "today" && s !== "today") return false;
        if (dueFilter === "none" && s !== "none") return false;
        if (dueFilter === "week" && !(s === "today" || s === "tomorrow" || s === "upcoming"))
          return false;
      }
      return true;
    };
  }, [board.cards, query, tagFilter, completedFilter, dueFilter]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const collisionDetectionStrategy: CollisionDetection = (args) => {
    // Prefer whatever the pointer is directly over — lets users drop into
    // the empty area below the last card in a column.
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) return pointerCollisions;
    const rectCollisions = rectIntersection(args);
    if (rectCollisions.length > 0) return rectCollisions;
    return closestCenter(args);
  };

  function onDragStart(e: DragStartEvent) {
    const t = e.active.data.current?.type;
    if (t === "card") {
      const cardId = e.active.id as string;
      const column = findColumnByCard(cardId);
      cardDragOriginRef.current = column ? { cardId, columnId: column.id } : null;
      setActiveCardId(cardId);
    }
    if (t === "column") setActiveColumnId(e.active.id as string);
  }

  function findColumnByCard(cardId: string) {
    return board.columns.find((c) => c.cardIds.includes(cardId));
  }

  function onDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const activeType = active.data.current?.type;
    if (activeType !== "card") return;

    const activeCol = findColumnByCard(active.id as string);
    if (!activeCol) return;

    const overType = over.data.current?.type;
    let targetCol = null as null | string;
    let targetIndex = 0;

    if (overType === "card") {
      const c = findColumnByCard(over.id as string);
      if (!c) return;
      targetCol = c.id;
      targetIndex = c.cardIds.indexOf(over.id as string);
    } else if (overType === "column-body") {
      targetCol = over.data.current!.columnId as string;
      const col = board.columns.find((x) => x.id === targetCol);
      targetIndex = col ? col.cardIds.length : 0;
    }

    if (!targetCol) return;
    if (activeCol.id === targetCol) return;

    store.previewMoveCard(active.id as string, targetCol, targetIndex);
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    const origin = cardDragOriginRef.current;
    cardDragOriginRef.current = null;
    setActiveCardId(null);
    setActiveColumnId(null);
    if (!over) {
      store.cancelCardMovePreview();
      return;
    }

    const activeType = active.data.current?.type;

    if (activeType === "column") {
      if (active.id !== over.id) {
        store.reorderColumns(active.id as string, over.id as string);
      }
      return;
    }

    if (activeType === "card") {
      if (!origin || origin.cardId !== active.id) {
        store.cancelCardMovePreview();
        return;
      }
      const activeCol = findColumnByCard(active.id as string);
      if (!activeCol) {
        store.cancelCardMovePreview();
        return;
      }
      const overType = over.data.current?.type;
      let finalOrder: string[] | null = null;

      if (overType === "card") {
        const overCol = findColumnByCard(over.id as string);
        if (!overCol) {
          store.cancelCardMovePreview();
          return;
        }
        if (overCol.id === activeCol.id) {
          const oldIdx = activeCol.cardIds.indexOf(active.id as string);
          const newIdx = overCol.cardIds.indexOf(over.id as string);
          if (oldIdx !== newIdx) {
            finalOrder = arrayMove(activeCol.cardIds, oldIdx, newIdx);
          }
        }
      } else if (overType !== "column-body") {
        store.cancelCardMovePreview();
        return;
      }

      store.commitCardMovePreview(
        active.id as string,
        origin.columnId,
        finalOrder ? { columnId: activeCol.id, cardIds: finalOrder } : undefined,
      );
    }
  }

  function onDragCancel(_event: DragCancelEvent) {
    cardDragOriginRef.current = null;
    setActiveCardId(null);
    setActiveColumnId(null);
    store.cancelCardMovePreview();
  }

  const activeCard = activeCardId ? board.cards[activeCardId] : null;
  const activeColumn = activeColumnId ? board.columns.find((c) => c.id === activeColumnId) : null;

  return (
    <div className="flex flex-col h-screen h-[100dvh] bg-background">
      {/* Toolbar */}
      <header className="shrink-0 border-b border-border bg-surface/60 backdrop-blur px-3 sm:px-4 py-1.5 sm:py-0 sm:h-12 flex items-center gap-2 flex-wrap sm:flex-nowrap">
        <div className="flex items-center gap-2 mr-1 shrink-0">
          <img
            src={flowmarkIcon}
            alt="FlowMark"
            width={24}
            height={24}
            className="h-6 w-6 rounded-md"
          />
          <span className="font-semibold text-sm tracking-tight">FlowMark</span>
        </div>

        <div className="relative order-3 sm:order-none w-full sm:w-auto sm:flex-1 sm:min-w-0 sm:max-w-md">
          <Search
            size={13}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search cards…"
            className="w-full h-8 bg-surface-sunken border border-border rounded-md pl-7 pr-8 text-sm outline-none focus:border-primary/60"
          />
          <span className="ds-kbd absolute right-2 top-1/2 -translate-y-1/2 hidden sm:inline">
            /
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2 shrink-0 overflow-x-auto max-w-full">
          <FilterChip
            label="Due"
            value={dueFilter}
            options={[
              ["all", "All"],
              ["overdue", "Overdue"],
              ["today", "Today"],
              ["week", "Upcoming"],
              ["none", "No date"],
            ]}
            onChange={(v) => setDueFilter(v as DueFilter)}
          />
          <FilterChip
            label="Status"
            value={completedFilter}
            options={[
              ["all", "All"],
              ["open", "Open"],
              ["done", "Completed"],
            ]}
            onChange={(v) => setCompletedFilter(v as CompletedFilter)}
          />
          <RulesButton />
          <ManageTagsButton selectedTagIds={tagFilter} onSelectedTagIdsChange={setTagFilter} />
          <ThemeSwitcher initialTheme={initialTheme} />
          <ReloadWorkspaceButton cards={board.cards} />
        </div>
      </header>

      {sync.status === "error" && (
        <div
          role="alert"
          className="shrink-0 flex items-center gap-3 border-b border-danger/40 bg-danger/10 px-3 sm:px-4 py-2 text-xs text-danger"
        >
          <div className="min-w-0 flex-1">
            <span className="font-semibold">Workspace disconnected.</span> The last change was not
            saved and the board was restored to its last confirmed state. Restart Flowmark, then
            reconnect.
          </div>
          <button
            type="button"
            onClick={() => void store.reloadFromDisk()}
            className="shrink-0 rounded-md border border-danger/40 px-2.5 py-1 font-medium hover:bg-danger/10"
          >
            Reconnect
          </button>
        </div>
      )}

      {/* Board */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetectionStrategy}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
        >
          <SortableContext
            items={board.columns.map((c) => c.id)}
            strategy={horizontalListSortingStrategy}
          >
            <div className="flex gap-3 p-4 h-full items-stretch min-w-max">
              {board.columns.map((col) => (
                <ColumnView
                  key={col.id}
                  column={col}
                  onOpenCard={setOpenCardId}
                  cardFilter={filterCard}
                />
              ))}
              <AddColumnButton />
            </div>
          </SortableContext>

          <DragOverlay dropAnimation={null}>
            {activeCard && (
              <div className="ds-card ds-card-dragging p-2.5 w-[280px]">
                <div className="overflow-wrap-anywhere text-[13px] font-medium">
                  <MarkdownInline>{activeCard.title}</MarkdownInline>
                </div>
              </div>
            )}
            {activeColumn && (
              <div className="ds-column w-[300px] opacity-90">
                <div className="px-3 py-2.5 text-sm font-semibold">{activeColumn.name}</div>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Footer / shortcuts */}
      <footer className="shrink-0 border-t border-border bg-surface-sunken/50 px-3 sm:px-4 py-1.5 flex items-center gap-4 text-[11px] text-subtle-foreground">
        <span className="hidden sm:inline-flex items-center gap-1">
          <span className="ds-kbd">/</span> search
        </span>
        <span className="hidden sm:inline-flex items-center gap-1">
          <span className="ds-kbd">N</span> new card
        </span>
        <span className="hidden sm:inline-flex items-center gap-1">
          <span className="ds-kbd">Esc</span> close
        </span>
        <code
          className="ml-auto min-w-0 truncate font-mono text-[11px]"
          title={sync.filePath ?? "…"}
        >
          {sync.filePath ?? "…"}
        </code>
      </footer>

      <CardModal
        cardId={openCardId}
        isDraft={openCardId !== null && openCardId === draftCardId}
        onClose={() => {
          setOpenCardId(null);
          setDraftCardId(null);
        }}
        onSaveDraft={() => {
          setOpenCardId(null);
          setDraftCardId(null);
        }}
      />

      <NewCardColumnPicker
        open={pickerOpen}
        columns={board.columns}
        onClose={() => setPickerOpen(false)}
        onPick={(columnId) => {
          setPickerOpen(false);
          const id = store.addCard(columnId, "Untitled");
          setDraftCardId(id);
          setOpenCardId(id);
        }}
      />
    </div>
  );
}

function AddColumnButton() {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  const submit = () => {
    const v = name.trim();
    if (v) store.addColumn(v);
    setName("");
    setAdding(false);
  };

  if (!adding) {
    return (
      <button
        onClick={() => setAdding(true)}
        className="self-start shrink-0 w-[300px] h-12 rounded-xl border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-border-strong hover:bg-surface/50 transition text-sm inline-flex items-center justify-center gap-1.5"
      >
        <Plus size={13} /> Add column
      </button>
    );
  }

  return (
    <div className="self-start shrink-0 w-[300px] ds-column p-2 space-y-1.5">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") {
            setAdding(false);
            setName("");
          }
        }}
        autoFocus
        placeholder="Column name…"
        className="w-full bg-surface border border-border rounded-md px-2 py-1.5 text-sm outline-none focus:border-primary/60"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={submit}
          className="bg-primary text-primary-foreground text-xs font-medium px-2.5 py-1 rounded-md hover:opacity-90"
        >
          Add column
        </button>
        <button
          onClick={() => {
            setAdding(false);
            setName("");
          }}
          className="text-xs text-muted-foreground px-2 py-1 hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ReloadWorkspaceButton({ cards }: { cards: Record<string, Card> }) {
  const [reloading, setReloading] = useState(false);
  const latestCardUpdate = Object.values(cards)
    .map((card) => card.updatedAt)
    .filter(Boolean)
    .sort()
    .at(-1);
  const title = reloading
    ? "Reloading workspace from disk…"
    : latestCardUpdate
      ? `Last card update: ${new Date(latestCardUpdate).toLocaleString()}\n(click to reload from disk)`
      : "Reload workspace from disk";

  async function reload() {
    if (reloading) return;
    setReloading(true);
    try {
      await reloadWithMinimumFeedback(() => store.reloadFromDisk());
    } finally {
      setReloading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void reload()}
      disabled={reloading}
      aria-busy={reloading}
      aria-label={reloading ? "Reloading workspace from disk" : "Reload workspace from disk"}
      className={cn(
        "h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-md text-muted-foreground transition-[color,background-color,transform] hover:text-foreground hover:bg-accent active:scale-95 disabled:cursor-wait",
        reloading && "bg-accent text-foreground",
      )}
      title={title}
    >
      <RotateCcw size={13} className={cn(reloading && "flowmark-reload-spin")} />
    </button>
  );
}

function FilterChip({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 h-8 text-xs text-muted-foreground bg-surface-sunken border border-border rounded-md px-2">
      <span className="text-subtle-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent outline-none text-foreground/90 cursor-pointer"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v} className="bg-popover">
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

const LAST_COLUMN_KEY = "flow.newCardLastColumn";

function NewCardColumnPicker({
  open,
  columns,
  onClose,
  onPick,
}: {
  open: boolean;
  columns: { id: string; name: string }[];
  onClose: () => void;
  onPick: (columnId: string) => void;
}) {
  const [selected, setSelected] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem(LAST_COLUMN_KEY);
    } catch {
      // Browser storage is optional; fall back to the first column.
    }
    const valid =
      remembered && columns.some((c) => c.id === remembered) ? remembered : (columns[0]?.id ?? "");
    setSelected(valid);
  }, [open, columns]);

  function confirm() {
    if (!selected) return;
    try {
      localStorage.setItem(LAST_COLUMN_KEY, selected);
    } catch {
      // The selection remains usable when browser storage is unavailable.
    }
    onPick(selected);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-[calc(100vw-1rem)] sm:w-auto max-w-sm bg-surface border-border">
        <DialogTitle className="text-sm font-semibold">New card</DialogTitle>
        <DialogDescription className="text-xs text-muted-foreground">
          Choose a column for the new card. Your last choice is remembered.
        </DialogDescription>
        <div className="flex flex-col gap-1 max-h-64 overflow-auto mt-1">
          {columns.map((c) => {
            const active = selected === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setSelected(c.id)}
                onDoubleClick={confirm}
                className={cn(
                  "flex items-center justify-between px-2.5 h-9 rounded-md border text-sm text-left transition",
                  active
                    ? "border-primary/60 bg-primary/10 text-foreground"
                    : "border-border bg-surface-sunken hover:bg-accent text-foreground/90",
                )}
              >
                <span className="truncate">{c.name}</span>
                {active && <Check size={13} className="text-primary shrink-0" />}
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-end gap-2 mt-2">
          <button
            onClick={onClose}
            className="h-8 px-3 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent"
          >
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={!selected}
            className="h-8 px-3 rounded-md text-xs bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
