import { useEffect, useState } from "react";
import { store, useBoard } from "@/lib/store";
import { TAG_COLORS, tagColorVar } from "@/lib/tag-colors";
import type { Card, Tag, TagColor } from "@/lib/types";
import { TagPill } from "./TagPill";
import { Check, Plus, X, Tag as TagIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function TagPicker({ card, children }: { card: Card; children: React.ReactNode }) {
  const { tags } = useBoard();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<TagColor>("blue");

  const filtered = tags.filter((t) => t.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-64 p-2 bg-popover border-border" align="start">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tags…"
          className="w-full bg-surface-sunken border border-border rounded-md px-2 py-1.5 text-sm outline-none focus:border-primary/60"
          autoFocus
        />
        <div className="mt-2 max-h-56 overflow-auto flex flex-col gap-0.5">
          {filtered.map((t) => {
            const active = card.tagIds.includes(t.id);
            return (
              <button
                key={t.id}
                onClick={() => store.toggleCardTag(card.id, t.id)}
                className="flex items-center justify-between px-1.5 py-1 rounded hover:bg-accent text-left"
              >
                <TagPill tag={t} />
                {active && <Check size={14} className="text-primary" />}
              </button>
            );
          })}
        </div>
        <div className="mt-2 pt-2 border-t border-border">
          {!creating ? (
            <button
              onClick={() => setCreating(true)}
              className="w-full flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-1.5 py-1"
            >
              <Plus size={12} /> New tag
            </button>
          ) : (
            <div className="space-y-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Tag name"
                className="w-full bg-surface-sunken border border-border rounded-md px-2 py-1.5 text-sm outline-none focus:border-primary/60"
              />
              <div className="flex gap-1.5 flex-wrap">
                {TAG_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setNewColor(c)}
                    className="w-5 h-5 rounded-full border-2 transition"
                    style={{
                      background: `color-mix(in oklab, ${tagColorVar[c]} 30%, transparent)`,
                      borderColor: c === newColor ? tagColorVar[c] : "transparent",
                    }}
                    aria-label={c}
                  />
                ))}
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => {
                    if (!newName.trim()) return;
                    store.addTag(newName.trim(), newColor);
                    setNewName("");
                    setCreating(false);
                  }}
                  className="flex-1 text-xs bg-primary text-primary-foreground rounded-md px-2 py-1 hover:opacity-90"
                >
                  Create
                </button>
                <button
                  onClick={() => setCreating(false)}
                  className="text-xs text-muted-foreground rounded-md px-2 py-1 hover:bg-accent"
                >
                  <X size={12} />
                </button>
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ManageTagsButton({
  selectedTagIds,
  onSelectedTagIdsChange,
}: {
  selectedTagIds: string[];
  onSelectedTagIdsChange: (tagIds: string[]) => void;
}) {
  const { tags } = useBoard();
  const activeFilterCount = selectedTagIds.length;

  useEffect(() => {
    const availableTagIds = new Set(tags.map((tag) => tag.id));
    const validSelectedTagIds = selectedTagIds.filter((id) => availableTagIds.has(id));
    if (validSelectedTagIds.length !== selectedTagIds.length) {
      onSelectedTagIdsChange(validSelectedTagIds);
    }
  }, [tags, selectedTagIds, onSelectedTagIdsChange]);

  function toggleFilter(tagId: string) {
    onSelectedTagIdsChange(
      selectedTagIds.includes(tagId)
        ? selectedTagIds.filter((id) => id !== tagId)
        : [...selectedTagIds, tagId],
    );
  }

  function removeTag(tagId: string) {
    if (selectedTagIds.includes(tagId)) {
      onSelectedTagIdsChange(selectedTagIds.filter((id) => id !== tagId));
    }
    store.deleteTag(tagId);
  }

  return (
    <Popover>
      <PopoverTrigger
        className="inline-flex items-center gap-1.5 h-8 text-xs bg-surface-sunken border border-border rounded-md px-2.5 hover:bg-accent"
        aria-label={
          activeFilterCount > 0
            ? `Tags, ${activeFilterCount} active filter${activeFilterCount === 1 ? "" : "s"}`
            : "Tags"
        }
      >
        <TagIcon size={12} className="text-muted-foreground" />
        Tags
        {activeFilterCount > 0 ? (
          <span className="rounded-full bg-primary/15 px-1.5 text-[10px] font-medium text-primary">
            {activeFilterCount}
          </span>
        ) : (
          tags.length > 0 && (
            <span className="text-[10px] text-subtle-foreground">· {tags.length}</span>
          )
        )}
      </PopoverTrigger>

      <PopoverContent className="w-72 bg-popover p-2" align="end">
        <section>
          <div className="mb-1.5 flex items-center justify-between">
            <div className="text-xs font-medium text-muted-foreground">Filter board</div>
            {activeFilterCount > 0 && (
              <button
                onClick={() => onSelectedTagIdsChange([])}
                className="text-[11px] text-muted-foreground hover:text-foreground"
              >
                Clear filter
              </button>
            )}
          </div>
          {tags.length === 0 ? (
            <div className="px-1 py-1 text-xs text-subtle-foreground">No tags yet</div>
          ) : (
            <div className="flex max-h-40 flex-col gap-0.5 overflow-auto">
              {tags.map((t) => {
                const active = selectedTagIds.includes(t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() => toggleFilter(t.id)}
                    className="flex items-center justify-between gap-2 rounded px-1.5 py-1 text-left hover:bg-accent"
                    aria-pressed={active}
                  >
                    <TagPill tag={t} />
                    {active && <Check size={13} className="shrink-0 text-primary" />}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <div className="my-2 border-t border-border" />

        <section>
          <div className="mb-2 text-xs font-medium text-muted-foreground">Tag library</div>
          <div className="flex flex-col gap-1">
            {tags.map((t) => (
              <TagRow key={t.id} tag={t} onDelete={() => removeTag(t.id)} />
            ))}
          </div>
        </section>
      </PopoverContent>
    </Popover>
  );
}

function TagRow({ tag, onDelete }: { tag: Tag; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(tag.name);
  return (
    <div className="flex items-center justify-between gap-1 px-1 py-0.5">
      {editing ? (
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            store.updateTag(tag.id, { name: name.trim() || tag.name });
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          autoFocus
          className="flex-1 bg-surface-sunken border border-border rounded px-1.5 py-0.5 text-xs outline-none"
        />
      ) : (
        <button onClick={() => setEditing(true)} className="flex-1 text-left">
          <TagPill tag={tag} />
        </button>
      )}
      <div className="flex gap-0.5">
        {TAG_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => store.updateTag(tag.id, { color: c })}
            className="w-3 h-3 rounded-full border"
            style={{
              background: `color-mix(in oklab, ${tagColorVar[c]} 40%, transparent)`,
              borderColor: c === tag.color ? tagColorVar[c] : "transparent",
            }}
            aria-label={`Set ${tag.name} color to ${c}`}
          />
        ))}
        <button
          onClick={onDelete}
          className="text-muted-foreground hover:text-danger ml-1"
          aria-label={`Delete ${tag.name}`}
        >
          <X size={11} />
        </button>
      </div>
    </div>
  );
}
