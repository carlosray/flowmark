import { isCardId } from "./card-links";

export function parseCardSearch(search: Record<string, unknown>) {
  return isCardId(search.card) ? { card: search.card } : {};
}

export function resolveRequestedCardId(
  requestedCardId: string | null,
  cards: Record<string, unknown>,
  syncStatus: "idle" | "loading" | "saving" | "saved" | "error",
) {
  if (!requestedCardId) return null;
  if (syncStatus !== "saved" && syncStatus !== "error") return requestedCardId;
  return cards[requestedCardId] ? requestedCardId : null;
}
