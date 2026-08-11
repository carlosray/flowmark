import type { Card } from "./types";

export interface CardMentionQuery {
  start: number;
  query: string;
}

// Trigger: `flowmark:` at a word boundary, followed only by mention query
// characters up to the caret. A `//` (as in a inserted link) never re-triggers.
const MENTION_TRIGGER = /(?:^|\s)flowmark:([\w-]*)$/;

export function findCardMentionQuery(text: string, caret: number): CardMentionQuery | null {
  const match = MENTION_TRIGGER.exec(text.slice(0, caret));
  if (!match) return null;
  return { start: caret - match[1].length - "flowmark:".length, query: match[1] };
}

export function rankCardMentions(cards: Card[], query: string, limit = 8): Card[] {
  const q = query.toLowerCase();
  const score = (card: Card) => {
    const title = card.title.toLowerCase();
    if (!q) return 0;
    if (title === q) return 0;
    if (title.startsWith(q)) return 1;
    if (title.includes(q)) return 2;
    if (card.id.toLowerCase().includes(q)) return 3;
    return -1;
  };
  return cards
    .map((card) => ({ card, rank: score(card) }))
    .filter(({ rank }) => rank >= 0)
    .sort((a, b) => a.rank - b.rank || b.card.updatedAt.localeCompare(a.card.updatedAt))
    .slice(0, limit)
    .map(({ card }) => card);
}

export function applyCardMention(
  text: string,
  caret: number,
  mentionStart: number,
  cardId: string,
): { text: string; caret: number } {
  const url = `flowmark://${cardId}`;
  const next = `${text.slice(0, mentionStart)}${url}${text.slice(caret)}`;
  return { text: next, caret: mentionStart + url.length };
}
