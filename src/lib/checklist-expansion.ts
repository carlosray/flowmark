import { useSyncExternalStore } from "react";

import { saveExpandedChecklistCardIds } from "./checklist-expansion.functions";

type SaveExpansion = (cardIds: string[]) => Promise<void>;

function normalize(cardIds: Iterable<string>) {
  return [...new Set(cardIds)].sort();
}

export class ChecklistExpansionStore {
  private expanded = new Set<string>();
  private listeners = new Set<() => void>();
  private saveQueue = Promise.resolve();

  constructor(
    private readonly save: SaveExpansion = async (cardIds) => {
      await saveExpandedChecklistCardIds({ data: { cardIds } });
    },
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.expanded;

  hydrate(cardIds: Iterable<string>) {
    this.expanded = new Set(normalize(cardIds));
    this.emit();
  }

  isExpanded(cardId: string) {
    return this.expanded.has(cardId);
  }

  toggle(cardId: string) {
    const next = new Set(this.expanded);
    if (next.has(cardId)) next.delete(cardId);
    else next.add(cardId);
    this.expanded = next;
    this.emit();

    const cardIds = normalize(next);
    this.saveQueue = this.saveQueue.then(() => this.save(cardIds)).catch(() => undefined);
  }

  async flushPendingSave() {
    await this.saveQueue.catch(() => undefined);
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }
}

export const checklistExpansionStore = new ChecklistExpansionStore();

export function useChecklistExpanded(cardId: string) {
  const expanded = useSyncExternalStore(
    checklistExpansionStore.subscribe,
    checklistExpansionStore.getSnapshot,
    checklistExpansionStore.getSnapshot,
  );
  return expanded.has(cardId);
}
