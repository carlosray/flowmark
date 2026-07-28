import { tagColorVar } from "@/lib/tag-colors";
import type { Tag } from "@/lib/types";
import { X } from "lucide-react";

export function TagPill({
  tag,
  onRemove,
  onClick,
  interactive,
}: {
  tag: Tag;
  onRemove?: () => void;
  onClick?: () => void;
  interactive?: boolean;
}) {
  return (
    <span
      className="ds-tag"
      style={{ color: tagColorVar[tag.color] }}
      onClick={onClick}
      role={interactive || onClick ? "button" : undefined}
    >
      <span style={{ color: "var(--foreground)", opacity: 0.85 }}>{tag.name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="opacity-60 hover:opacity-100 -mr-1"
          aria-label={`Remove ${tag.name}`}
        >
          <X size={10} />
        </button>
      )}
    </span>
  );
}
