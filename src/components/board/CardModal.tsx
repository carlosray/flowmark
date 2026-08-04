import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { store, useBoard, useBoardSync } from "@/lib/store";
import { rulesStore } from "@/lib/rules";
import { hasMoreScrollableContent, saveCardContentBeforeClose } from "@/lib/card-modal-state";
import type { Card } from "@/lib/types";
import { TagPill } from "./TagPill";
import { TagPicker } from "./TagPicker";
import { DueDatePicker } from "./DueDatePicker";
import { EditableMarkdown } from "./EditableMarkdown";
import { ChecklistItemText } from "./ChecklistItemText";
import {
  CheckSquare,
  MessageSquare,
  Plus,
  Tag as TagIcon,
  Trash2,
  X,
  Pencil,
  CheckCircle2,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";

export function CardModal({
  cardId,
  onClose,
  isDraft = false,
  onSaveDraft,
}: {
  cardId: string | null;
  onClose: () => void;
  isDraft?: boolean;
  onSaveDraft?: () => void;
}) {
  const board = useBoard();
  const card = cardId ? board.cards[cardId] : null;

  if (!card) return null;

  return (
    <OpenCardModal
      key={card.id}
      card={card}
      onClose={onClose}
      isDraft={isDraft}
      onSaveDraft={onSaveDraft}
    />
  );
}

function OpenCardModal({
  card,
  onClose,
  isDraft,
  onSaveDraft,
}: {
  card: Card;
  onClose: () => void;
  isDraft: boolean;
  onSaveDraft?: () => void;
}) {
  const [title, setTitle] = useState(card.title);
  const [desc, setDesc] = useState(card.description);
  const closingRef = useRef(false);

  useEffect(() => {
    rulesStore.holdCard(card.id);
    return () => rulesStore.releaseCard(card.id);
  }, [card.id]);

  async function saveAndClose() {
    if (closingRef.current) return;
    closingRef.current = true;

    await saveCardContentBeforeClose({
      card,
      title,
      description: desc,
      updateCard: (id, patch) => store.updateCard(id, patch),
      flushPendingSave: () => store.flushPendingSave(),
      onClose: isDraft && onSaveDraft ? onSaveDraft : onClose,
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && void saveAndClose()}>
      <DialogContent className="w-[calc(100vw-1rem)] sm:w-[92vw] max-w-[1080px] h-[90dvh] sm:h-[min(88vh,900px)] bg-surface border-border p-0 gap-0 overflow-hidden flex flex-col">
        <DialogTitle className="sr-only">{card.title}</DialogTitle>
        <DialogDescription className="sr-only">
          Edit the card title, due date, description, checklist, comments, and archive state.
        </DialogDescription>
        <CardEditor
          card={card}
          title={title}
          onTitleChange={setTitle}
          desc={desc}
          onDescChange={setDesc}
          onClose={onClose}
          isDraft={isDraft}
          onSaveAndClose={saveAndClose}
        />
      </DialogContent>
    </Dialog>
  );
}

function CardEditor({
  card,
  title,
  onTitleChange,
  desc,
  onDescChange,
  onClose,
  isDraft = false,
  onSaveAndClose,
}: {
  card: Card;
  title: string;
  onTitleChange: (title: string) => void;
  desc: string;
  onDescChange: (description: string) => void;
  onClose: () => void;
  isDraft?: boolean;
  onSaveAndClose: () => Promise<void>;
}) {
  const board = useBoard();
  const { tags } = board;
  const sync = useBoardSync();
  const cardTags = card.tagIds
    .map((id) => tags.find((t) => t.id === id))
    .filter(Boolean) as typeof tags;

  const filePath = sync.filePath ? `${sync.filePath}/cards/${card.id}.md` : `cards/${card.id}.md`;

  const [newItem, setNewItem] = useState("");
  const [newComment, setNewComment] = useState("");
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const scrollContentRef = useRef<HTMLDivElement>(null);
  const [showScrollCue, setShowScrollCue] = useState(false);

  useEffect(() => {
    const scrollArea = scrollAreaRef.current;
    const scrollContent = scrollContentRef.current;
    if (!scrollArea || !scrollContent) return;

    const updateScrollCue = () => setShowScrollCue(hasMoreScrollableContent(scrollArea));
    updateScrollCue();

    const observer = new ResizeObserver(updateScrollCue);
    observer.observe(scrollArea);
    observer.observe(scrollContent);
    return () => observer.disconnect();
  }, []);

  const checklistDone = card.checklist.filter((i) => i.done).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-start gap-2 p-4 border-b border-border">
        <button
          onClick={() => store.toggleCompleted(card.id)}
          className={cn(
            "mt-1 shrink-0 w-5 h-5 rounded-full border-2 transition-colors flex items-center justify-center",
            card.completed
              ? "bg-success border-success text-primary-foreground"
              : "border-border-strong hover:border-primary",
          )}
        >
          {card.completed && <CheckCircle2 size={14} />}
        </button>
        <EditableMarkdown
          value={title}
          onDraftChange={(value) => onTitleChange(value.replace(/\n/g, ""))}
          onSave={(value) => {
            if (value !== card.title) store.updateCard(card.id, { title: value });
          }}
          normalizeValue={(value) => value.replace(/\n/g, "").trim() || "Untitled"}
          inline
          ariaLabel="Edit card title"
          previewClassName={cn(
            "overflow-wrap-anywhere min-w-0 flex-1 rounded px-1 pb-1 text-lg font-semibold hover:bg-surface-hover",
            card.completed && "line-through text-muted-foreground",
          )}
          editorClassName={cn(
            "min-w-0 flex-1 text-lg font-semibold",
            card.completed && "text-muted-foreground line-through",
          )}
        />
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollAreaRef}
          onScroll={(event) => setShowScrollCue(hasMoreScrollableContent(event.currentTarget))}
          className="h-full overflow-y-auto overscroll-contain"
        >
          <div ref={scrollContentRef} className="flex min-h-full flex-col gap-5 p-4 sm:p-6">
            {/* Meta row */}
            <div className="flex flex-wrap items-center gap-2">
              <TagPicker card={card}>
                <button className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-border rounded-md px-2 py-1 hover:bg-accent">
                  <TagIcon size={11} /> Tags
                </button>
              </TagPicker>
              {cardTags.map((t) => (
                <TagPill key={t.id} tag={t} onRemove={() => store.toggleCardTag(card.id, t.id)} />
              ))}

              <div className="mx-1 w-px h-4 bg-border" />

              <DueDatePicker
                dueDate={card.dueDate}
                onChange={(dueDate) => store.updateCard(card.id, { dueDate })}
              />
            </div>

            {/* Description */}
            <section>
              <SectionHeader icon={<Pencil size={13} />} title="Description" />
              <EditableMarkdown
                value={desc}
                onDraftChange={onDescChange}
                onSave={(description) => {
                  if (description !== card.description) {
                    store.updateCard(card.id, { description });
                  }
                }}
                multiline
                editWhenEmpty
                ariaLabel="Edit card description"
                placeholder="Add a description…"
                previewClassName="prose-flow min-h-[180px] rounded-md border border-border bg-surface-sunken p-4 text-sm text-foreground/90"
                editorClassName="min-h-[180px]"
              />
            </section>

            {/* Checklist */}
            <section>
              <SectionHeader
                icon={<CheckSquare size={13} />}
                title="Checklist"
                action={
                  card.checklist.length > 0 && (
                    <span className="text-[11px] text-muted-foreground font-mono">
                      {checklistDone}/{card.checklist.length}
                    </span>
                  )
                }
              />
              <div className="min-w-0 space-y-1">
                {card.checklist.map((i) => (
                  <div key={i.id} className="group flex min-w-0 items-start gap-2">
                    <button
                      onClick={() => store.toggleChecklistItem(card.id, i.id)}
                      aria-label={
                        i.done ? "Mark checklist item incomplete" : "Complete checklist item"
                      }
                      className={cn(
                        "mt-1 shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition",
                        i.done
                          ? "bg-primary border-primary text-primary-foreground"
                          : "border-border-strong hover:border-primary",
                      )}
                    >
                      {i.done && <CheckCircle2 size={10} />}
                    </button>
                    <ChecklistItemText
                      text={i.text}
                      done={i.done}
                      editable
                      onSave={(text) => store.updateChecklistItem(card.id, i.id, text)}
                    />
                    <button
                      onClick={() => store.deleteChecklistItem(card.id, i.id)}
                      className="mt-1 shrink-0 opacity-0 text-muted-foreground hover:text-danger group-hover:opacity-100"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!newItem.trim()) return;
                    store.addChecklistItem(card.id, newItem.trim());
                    setNewItem("");
                  }}
                  className="flex items-center gap-2"
                >
                  <Plus size={12} className="text-muted-foreground" />
                  <input
                    value={newItem}
                    onChange={(e) => setNewItem(e.target.value)}
                    placeholder="Add item"
                    className="flex-1 bg-transparent outline-none text-sm py-0.5 border-b border-transparent focus:border-border placeholder:text-subtle-foreground"
                  />
                </form>
              </div>
            </section>

            {/* Comments */}
            <section>
              <SectionHeader
                icon={<MessageSquare size={13} />}
                title={`Comments (${card.comments.length})`}
              />
              <div className="space-y-2">
                {card.comments.map((c) => (
                  <div
                    key={c.id}
                    className="bg-surface-sunken border border-border rounded-md p-2.5 group"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-subtle-foreground font-mono">
                        {new Date(c.createdAt).toLocaleString()}
                      </span>
                      <button
                        onClick={() => store.deleteComment(card.id, c.id)}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-danger"
                      >
                        <X size={11} />
                      </button>
                    </div>
                    <EditableMarkdown
                      value={c.body}
                      onSave={(body) => store.updateComment(card.id, c.id, body)}
                      normalizeValue={(body) => body.trim() || c.body}
                      multiline
                      ariaLabel="Edit comment"
                      previewClassName="prose-flow rounded px-1 py-0.5 text-sm text-foreground/90 hover:bg-surface-hover"
                      editorClassName="min-h-[96px]"
                    />
                  </div>
                ))}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!newComment.trim()) return;
                    store.addComment(card.id, newComment.trim());
                    setNewComment("");
                  }}
                >
                  <textarea
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder="Write a comment… (Markdown, ⌘+Enter to submit)"
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                        e.preventDefault();
                        if (newComment.trim()) {
                          store.addComment(card.id, newComment.trim());
                          setNewComment("");
                        }
                      }
                    }}
                    rows={2}
                    className="w-full font-mono text-[13px] bg-surface-sunken border border-border rounded-md p-2 outline-none focus:border-primary/60 resize-y"
                  />
                </form>
              </div>
            </section>

            <div className="mt-auto pt-2 border-t border-border space-y-1.5 text-[11px] text-subtle-foreground">
              <div className="flex items-center justify-between gap-2">
                <span>
                  Created {new Date(card.createdAt).toLocaleDateString()} · Updated{" "}
                  {new Date(card.updatedAt).toLocaleDateString()}
                </span>
                <div className="inline-flex items-center gap-2">
                  {isDraft && (
                    <button
                      onClick={() => void onSaveAndClose()}
                      className="bg-primary text-primary-foreground text-xs font-medium px-2.5 py-1 rounded-md hover:opacity-90"
                    >
                      Save card
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (
                        confirm(
                          "Archive this card? Its Markdown, comments, and checklists will be preserved.",
                        )
                      ) {
                        store.deleteCard(card.id);
                        onClose();
                      }
                    }}
                    className="inline-flex items-center gap-1 text-muted-foreground hover:text-danger"
                  >
                    <Trash2 size={11} /> Archive
                  </button>
                </div>
              </div>

              {filePath && (
                <div
                  className="font-mono text-[10px] text-subtle-foreground/80 truncate"
                  title={filePath}
                >
                  {filePath}
                </div>
              )}
            </div>
          </div>
        </div>

        {showScrollCue && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-14 items-end justify-center bg-gradient-to-t from-surface via-surface/90 to-transparent pb-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface/95 px-2.5 py-1 text-[11px] font-medium text-muted-foreground shadow-sm">
              Scroll for more <ChevronDown size={12} />
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function SectionHeader({
  icon,
  title,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-1.5">
      <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        {icon}
        {title}
      </div>
      {action}
    </div>
  );
}
