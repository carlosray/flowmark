import type { Card } from "./types";

type CardContent = Pick<Card, "title" | "description">;

export function buildCardContentPatch(
  card: CardContent,
  title: string,
  description: string,
): Partial<CardContent> {
  const nextTitle = title.trim() || "Untitled";
  const patch: Partial<CardContent> = {};

  if (nextTitle !== card.title) patch.title = nextTitle;
  if (description !== card.description) patch.description = description;

  return patch;
}

export async function saveCardContentBeforeClose({
  card,
  title,
  description,
  updateCard,
  flushPendingSave,
  onClose,
}: {
  card: CardContent & Pick<Card, "id">;
  title: string;
  description: string;
  updateCard: (id: string, patch: Partial<CardContent>) => void;
  flushPendingSave: () => Promise<void>;
  onClose: () => void;
}): Promise<void> {
  const patch = buildCardContentPatch(card, title, description);
  if (Object.keys(patch).length > 0) updateCard(card.id, patch);

  await flushPendingSave();
  onClose();
}

export function hasMoreScrollableContent({
  scrollHeight,
  clientHeight,
  scrollTop,
}: {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
}): boolean {
  return scrollHeight - clientHeight - scrollTop > 4;
}
