import type { Card } from "@/lib/types";

export function matchesCardSearch(card: Card, query: string) {
  const normalizedQuery = query.toLowerCase();
  if (!normalizedQuery) return true;

  const fullCardId = /^[a-z0-9]{12}$/.test(normalizedQuery)
    ? `card_${normalizedQuery}`
    : /^card_[a-z0-9]+$/.test(normalizedQuery)
      ? normalizedQuery
      : null;
  if (fullCardId) return card.id.toLowerCase() === fullCardId;

  return (
    card.title.toLowerCase().includes(normalizedQuery) ||
    card.description.toLowerCase().includes(normalizedQuery) ||
    card.checklist.some((item) => item.text.toLowerCase().includes(normalizedQuery)) ||
    card.comments.some((comment) => comment.body.toLowerCase().includes(normalizedQuery))
  );
}

export function matchesTagFilter(cardTagIds: string[], selectedTagIds: string[]) {
  return selectedTagIds.every((tagId) => cardTagIds.includes(tagId));
}
