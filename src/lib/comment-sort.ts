import { useSyncExternalStore } from "react";

import { saveCommentSortOrder } from "./comment-sort.functions";
import type { Comment } from "./types";
import type { CommentSortOrder } from "./workspace/runtime-preferences";

type SaveCommentSortOrder = (order: CommentSortOrder) => Promise<void>;

function timestamp(value: string) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

export function sortComments<T extends Comment>(comments: readonly T[], order: CommentSortOrder) {
  const direction = order === "descending" ? -1 : 1;
  return [...comments].sort((left, right) => {
    const dateDifference = timestamp(left.createdAt) - timestamp(right.createdAt);
    return dateDifference === 0 ? left.id.localeCompare(right.id) : dateDifference * direction;
  });
}

export class CommentSortStore {
  private order: CommentSortOrder = "descending";
  private persistedOrder: CommentSortOrder = "descending";
  private listeners = new Set<() => void>();
  private revision = 0;
  private saveQueue = Promise.resolve();

  constructor(
    private readonly save: SaveCommentSortOrder = async (order) => {
      await saveCommentSortOrder({ data: { order } });
    },
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.order;

  hydrate(order: CommentSortOrder) {
    this.order = order;
    this.persistedOrder = order;
    this.revision++;
    this.emit();
  }

  async setOrder(order: CommentSortOrder) {
    if (order === this.order) return;
    this.order = order;
    const revision = ++this.revision;
    this.emit();

    const save = this.saveQueue.then(async () => {
      await this.save(order);
      this.persistedOrder = order;
    });
    this.saveQueue = save.catch(() => undefined);

    try {
      await save;
    } catch (error) {
      if (this.revision === revision) {
        this.order = this.persistedOrder;
        this.emit();
      }
      throw error;
    }
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }
}

export const commentSortStore = new CommentSortStore();

export function useCommentSortOrder() {
  return useSyncExternalStore(
    commentSortStore.subscribe,
    commentSortStore.getSnapshot,
    commentSortStore.getSnapshot,
  );
}
