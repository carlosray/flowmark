import { useContext } from "react";
import { Link2 } from "lucide-react";

import { resolveCardReferenceTarget } from "@/lib/card-links";
import type { Card } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CardLinkContext } from "./card-link-context";

export function CardLink({ href, children }: { href: string; children?: React.ReactNode }) {
  const context = useContext(CardLinkContext);
  const cardId = resolveCardReferenceTarget(href, context?.workspacePath ?? null);
  const card = context && cardId ? context.cards[cardId] : undefined;

  if (!context || !card) {
    // Unknown, cross-workspace, or provider-less references stay plain text.
    return <span>{children}</span>;
  }

  return (
    <button
      type="button"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        context.openCard(card.id);
      }}
      title={`${card.title} (cards/${card.id}.md)`}
      className="inline-flex max-w-full items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-1.5 py-0 align-baseline text-[0.85em] font-medium text-primary no-underline transition-colors hover:border-primary hover:bg-primary/20"
    >
      <Link2 size={11} className="shrink-0" aria-hidden />
      <span className={cn("min-w-0 truncate", card.completed && "line-through opacity-70")}>
        {card.title}
      </span>
    </button>
  );
}

export function CardMentionMenu({
  suggestions,
  highlight,
  onHighlight,
  onPick,
}: {
  suggestions: Card[];
  highlight: number;
  onHighlight: (index: number) => void;
  onPick: (card: Card) => void;
}) {
  if (suggestions.length === 0) return null;

  return (
    <ul
      role="listbox"
      aria-label="Link a card"
      className="absolute inset-x-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg"
      onMouseDown={(event) => event.preventDefault()}
    >
      {suggestions.map((card, index) => (
        <li
          key={card.id}
          role="option"
          aria-selected={index === highlight}
          className={cn(
            "flex cursor-pointer items-baseline gap-2 rounded-sm px-2 py-1 text-[13px]",
            index === highlight ? "bg-accent text-foreground" : "text-foreground/90",
          )}
          onMouseEnter={() => onHighlight(index)}
          onClick={() => onPick(card)}
        >
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              card.completed && "text-muted-foreground line-through",
            )}
          >
            {card.title}
          </span>
          <code className="shrink-0 font-mono text-[10px] text-subtle-foreground">{card.id}</code>
        </li>
      ))}
    </ul>
  );
}
