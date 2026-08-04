import { useSyncExternalStore } from "react";
import type { RuleEvent } from "./rule-engine";
import type { Board, Card, Tag, TagColor, ChecklistItem } from "./types";
import { readWorkspace, saveWorkspace } from "./board.functions";

const COLLAPSED_KEY = "flow.columns.collapsed.v1";

function loadCollapsed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(COLLAPSED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}
function saveCollapsed(ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
}
function applyCollapsed(board: Board): Board {
  const ids = loadCollapsed();
  if (ids.size === 0) return board;
  return {
    ...board,
    columns: board.columns.map((c) => (ids.has(c.id) ? { ...c, collapsed: true } : c)),
  };
}

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function nowIso() {
  return new Date().toISOString();
}

function emptyBoard(): Board {
  return { columns: [], cards: {}, tags: [] };
}

function cloneBoard(board: Board): Board {
  return structuredClone(board);
}

function moveCardOnBoard(board: Board, cardId: string, toColumnId: string, toIndex: number): Board {
  const from = board.columns.find((column) => column.cardIds.includes(cardId));
  const target = board.columns.find((column) => column.id === toColumnId);
  if (!from || !target) return board;

  const columns = board.columns.map((column) => ({
    ...column,
    cardIds: column.cardIds.filter((id) => id !== cardId),
  }));
  const targetWithoutCard = columns.find((column) => column.id === toColumnId);
  if (!targetWithoutCard) return board;

  const cardIds = [...targetWithoutCard.cardIds];
  const index = Math.max(0, Math.min(toIndex, cardIds.length));
  cardIds.splice(index, 0, cardId);
  return {
    ...board,
    columns: columns.map((column) => (column.id === toColumnId ? { ...column, cardIds } : column)),
  };
}

function reorderColumnOnBoard(board: Board, columnId: string, cardIds: string[]): Board {
  const column = board.columns.find((candidate) => candidate.id === columnId);
  if (!column || cardIds.length !== column.cardIds.length) return board;

  const expectedIds = new Set(column.cardIds);
  const proposedIds = new Set(cardIds);
  if (
    proposedIds.size !== cardIds.length ||
    proposedIds.size !== expectedIds.size ||
    cardIds.some((cardId) => !expectedIds.has(cardId))
  ) {
    return board;
  }
  if (cardIds.every((cardId, index) => column.cardIds[index] === cardId)) return board;

  return {
    ...board,
    columns: board.columns.map((candidate) =>
      candidate.id === columnId ? { ...candidate, cardIds: [...cardIds] } : candidate,
    ),
  };
}

export type BoardEvent = RuleEvent;

export type SyncStatus = "idle" | "loading" | "saving" | "saved" | "error";

interface SyncSnapshot {
  status: SyncStatus;
  filePath: string | null;
  lastSyncedAt: string | null;
  error: string | null;
}

export interface BoardPersistence {
  read: () => Promise<{ path: string; board: Board }>;
  save: (board: Board) => Promise<{ path: string }>;
}

const defaultPersistence: BoardPersistence = {
  read: () => readWorkspace(),
  save: (board) => saveWorkspace({ data: { board } }),
};

export class BoardStore {
  private state: Board = emptyBoard();
  private movePreview: Board | null = null;
  private lastConfirmed: Board | null = null;
  private listeners = new Set<() => void>();
  private eventListeners = new Set<(e: BoardEvent) => void>();
  private hydrated = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saving = false;
  private applyingRemote = false;
  private _sync: SyncSnapshot = {
    status: "idle",
    filePath: null,
    lastSyncedAt: null,
    error: null,
  };

  constructor(
    private readonly persistence: BoardPersistence = defaultPersistence,
    private readonly saveDelayMs = 400,
  ) {}

  getSyncSnapshot = (): SyncSnapshot => this._sync;
  private setSync(patch: Partial<SyncSnapshot>) {
    this._sync = { ...this._sync, ...patch };
  }

  hydrate() {
    if (this.hydrated) return;
    this.hydrated = true;
    this.setSync({ status: "loading" });
    this.emit();
    void this.reloadFromDisk();
  }

  async reloadFromDisk() {
    this.setSync({ status: "loading", error: null });
    this.emit();
    try {
      const res = await this.persistence.read();
      this.applyingRemote = true;
      try {
        this.lastConfirmed = cloneBoard(res.board);
        this.state = applyCollapsed(cloneBoard(res.board));
        this.movePreview = null;
        this.setSync({
          filePath: res.path,
          status: "saved",
          lastSyncedAt: nowIso(),
          error: null,
        });
      } finally {
        this.applyingRemote = false;
      }
      this.emit();
    } catch (err) {
      this.setSync({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      this.emit();
    }
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.movePreview ?? this.state;

  isPreviewingMove() {
    return this.movePreview !== null;
  }

  onEvent(fn: (e: BoardEvent) => void) {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }
  private dispatch(e: BoardEvent) {
    for (const l of this.eventListeners) l(e);
  }

  private set(updater: (b: Board) => Board) {
    if (!this.applyingRemote && this._sync.status === "error") return;
    this.state = updater(this.state);
    if (!this.applyingRemote) this.scheduleSave();
    this.emit();
  }
  private emit() {
    for (const l of this.listeners) l();
  }

  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.setSync({ status: "saving" });
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flushSave();
    }, this.saveDelayMs);
  }

  async flushPendingSave(): Promise<void> {
    const hadPendingSave = this.saveTimer !== null;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    while (this.saving) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (!hadPendingSave || this._sync.status === "error") return;

    await this.flushSave();
  }

  private async flushSave() {
    if (this.saving) {
      // Coalesce: try again shortly
      this.saveTimer = setTimeout(() => {
        this.saveTimer = null;
        void this.flushSave();
      }, 200);
      return;
    }
    this.saving = true;
    const candidate = cloneBoard(this.state);
    try {
      const res = await this.persistence.save(candidate);
      this.lastConfirmed = cloneBoard(candidate);
      this.setSync({
        filePath: res.path,
        status: "saved",
        lastSyncedAt: nowIso(),
        error: null,
      });
    } catch (err) {
      this.applyingRemote = true;
      try {
        if (this.lastConfirmed) this.state = applyCollapsed(cloneBoard(this.lastConfirmed));
        this.movePreview = null;
      } finally {
        this.applyingRemote = false;
      }
      this.setSync({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.saving = false;
      this.emit();
    }
  }

  reset() {
    void this.reloadFromDisk();
  }

  /** Replace the entire board state (e.g. after loading from disk). */
  replace(next: Board) {
    this.set(() => next);
  }

  // Columns
  addColumn(name: string) {
    this.set((b) => ({
      ...b,
      columns: [...b.columns, { id: `column_${uid()}`, name, cardIds: [] }],
    }));
  }
  renameColumn(id: string, name: string) {
    this.set((b) => ({
      ...b,
      columns: b.columns.map((c) => (c.id === id ? { ...c, name } : c)),
    }));
  }
  deleteColumn(id: string) {
    this.set((b) => {
      const col = b.columns.find((c) => c.id === id);
      if (!col) return b;
      if (col.cardIds.length > 0) return b;
      const cards = { ...b.cards };
      for (const cid of col.cardIds) delete cards[cid];
      return {
        ...b,
        cards,
        columns: b.columns.filter((c) => c.id !== id),
      };
    });
  }
  reorderColumns(fromId: string, toId: string) {
    this.set((b) => {
      const arr = [...b.columns];
      const from = arr.findIndex((c) => c.id === fromId);
      const to = arr.findIndex((c) => c.id === toId);
      if (from < 0 || to < 0) return b;
      const [it] = arr.splice(from, 1);
      arr.splice(to, 0, it);
      return { ...b, columns: arr };
    });
  }
  toggleCollapsed(id: string) {
    // Local-only UI state — persisted to localStorage, not to disk.
    const ids = loadCollapsed();
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    saveCollapsed(ids);
    this.applyingRemote = true;
    try {
      this.set((b) => ({
        ...b,
        columns: b.columns.map((c) => (c.id === id ? { ...c, collapsed: ids.has(id) } : c)),
      }));
    } finally {
      this.applyingRemote = false;
    }
  }

  // Cards
  addCard(columnId: string, title: string): string {
    const card: Card = {
      id: `card_${uid()}`,
      title,
      description: "",
      dueDate: null,
      checklist: [],
      comments: [],
      tagIds: [],
      completed: false,
      completedAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.set((b) => ({
      ...b,
      cards: { ...b.cards, [card.id]: card },
      columns: b.columns.map((c) =>
        c.id === columnId ? { ...c, cardIds: [...c.cardIds, card.id] } : c,
      ),
    }));
    this.dispatch({ kind: "card.created", cardId: card.id, columnId });
    return card.id;
  }
  updateCard(id: string, patch: Partial<Card>) {
    const before = this.state.cards[id];
    if (!before) return;
    this.set((b) => {
      const cur = b.cards[id];
      if (!cur) return b;
      return {
        ...b,
        cards: {
          ...b.cards,
          [id]: { ...cur, ...patch, updatedAt: nowIso() },
        },
      };
    });
    const after = this.state.cards[id];
    if (!after) return;
    if (before.completed !== after.completed)
      this.dispatch({ kind: "card.completed", cardId: id, completed: after.completed });
    if (before.dueDate !== after.dueDate)
      this.dispatch({ kind: "card.dueStateChanged", cardId: id });
  }
  deleteCard(id: string) {
    this.set((b) => {
      const cards = { ...b.cards };
      delete cards[id];
      return {
        ...b,
        cards,
        columns: b.columns.map((c) => ({
          ...c,
          cardIds: c.cardIds.filter((x) => x !== id),
        })),
      };
    });
  }
  toggleCompleted(id: string) {
    const cur = this.state.cards[id];
    if (!cur) return;
    const next = !cur.completed;
    this.updateCard(id, { completed: next, completedAt: next ? nowIso() : null });
  }
  moveCard(cardId: string, toColumnId: string, toIndex: number) {
    let fromId: string | null = null;
    this.set((b) => {
      const from = b.columns.find((column) => column.cardIds.includes(cardId));
      if (!from) return b;
      fromId = from.id;
      return moveCardOnBoard(b, cardId, toColumnId, toIndex);
    });
    if (fromId && fromId !== toColumnId) {
      this.dispatch({
        kind: "card.moved",
        cardId,
        fromColumnId: fromId,
        toColumnId,
      });
    }
  }
  previewMoveCard(cardId: string, toColumnId: string, toIndex: number) {
    if (this._sync.status === "error") return;
    this.movePreview = moveCardOnBoard(this.movePreview ?? this.state, cardId, toColumnId, toIndex);
    this.emit();
  }
  cancelCardMovePreview() {
    if (!this.movePreview) return;
    this.movePreview = null;
    this.emit();
  }
  commitCardMovePreview(
    cardId: string,
    fromColumnId: string,
    finalOrder?: { columnId: string; cardIds: string[] },
  ) {
    if (!this.movePreview && !finalOrder) return;
    if (this._sync.status === "error") {
      this.movePreview = null;
      this.emit();
      return;
    }

    const base = this.movePreview ?? this.state;
    const next = finalOrder
      ? reorderColumnOnBoard(base, finalOrder.columnId, finalOrder.cardIds)
      : base;
    this.movePreview = null;
    if (next === this.state) {
      this.emit();
      return;
    }

    this.state = next;
    this.scheduleSave();
    this.emit();

    const toColumnId = this.state.columns.find((column) => column.cardIds.includes(cardId))?.id;
    if (toColumnId && fromColumnId !== toColumnId) {
      this.dispatch({ kind: "card.moved", cardId, fromColumnId, toColumnId });
    }
  }
  reorderCardsInColumn(columnId: string, newCardIds: string[]) {
    this.set((board) => reorderColumnOnBoard(board, columnId, newCardIds));
  }

  // Checklist
  addChecklistItem(cardId: string, text: string) {
    const card = this.state.cards[cardId];
    if (!card) return;
    const item: ChecklistItem = { id: `item_${uid()}`, text, done: false };
    this.updateCard(cardId, { checklist: [...card.checklist, item] });
  }
  toggleChecklistItem(cardId: string, itemId: string) {
    const card = this.state.cards[cardId];
    if (!card) return;
    this.updateCard(cardId, {
      checklist: card.checklist.map((i) => (i.id === itemId ? { ...i, done: !i.done } : i)),
    });
  }
  updateChecklistItem(cardId: string, itemId: string, text: string) {
    const card = this.state.cards[cardId];
    if (!card) return;
    this.updateCard(cardId, {
      checklist: card.checklist.map((i) => (i.id === itemId ? { ...i, text } : i)),
    });
  }
  deleteChecklistItem(cardId: string, itemId: string) {
    const card = this.state.cards[cardId];
    if (!card) return;
    this.updateCard(cardId, {
      checklist: card.checklist.filter((i) => i.id !== itemId),
    });
  }

  // Comments
  addComment(cardId: string, body: string) {
    const card = this.state.cards[cardId];
    if (!card) return;
    this.updateCard(cardId, {
      comments: [...card.comments, { id: `comment_${uid()}`, body, createdAt: nowIso() }],
    });
  }
  updateComment(cardId: string, commentId: string, body: string) {
    const card = this.state.cards[cardId];
    const comment = card?.comments.find((candidate) => candidate.id === commentId);
    if (!card || !comment || comment.body === body) return;
    this.updateCard(cardId, {
      comments: card.comments.map((candidate) =>
        candidate.id === commentId ? { ...candidate, body } : candidate,
      ),
    });
  }
  deleteComment(cardId: string, commentId: string) {
    const card = this.state.cards[cardId];
    if (!card) return;
    this.updateCard(cardId, {
      comments: card.comments.filter((c) => c.id !== commentId),
    });
  }

  // Tags
  addTag(name: string, color: TagColor) {
    this.set((b) => ({
      ...b,
      tags: [...b.tags, { id: `tag_${uid()}`, name, color }],
    }));
  }
  updateTag(id: string, patch: Partial<Tag>) {
    this.set((b) => ({
      ...b,
      tags: b.tags.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
  }
  deleteTag(id: string) {
    this.set((b) => ({
      ...b,
      tags: b.tags.filter((t) => t.id !== id),
      cards: Object.fromEntries(
        Object.entries(b.cards).map(([k, c]) => [
          k,
          { ...c, tagIds: c.tagIds.filter((x) => x !== id) },
        ]),
      ),
    }));
  }
  toggleCardTag(cardId: string, tagId: string) {
    const card = this.state.cards[cardId];
    if (!card) return;
    const has = card.tagIds.includes(tagId);
    this.updateCard(cardId, {
      tagIds: has ? card.tagIds.filter((x) => x !== tagId) : [...card.tagIds, tagId],
    });
  }
}

export const store = new BoardStore();

export function useBoard(): Board {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useBoardSync(): SyncSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSyncSnapshot, store.getSyncSnapshot);
}

export { uid };
