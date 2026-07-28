import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { store, type BoardEvent, type BoardStore } from "./store";
import { getRulesFile, saveRulesFile } from "./rules.functions";
import { applyRuleTransaction } from "./rule-engine";
import {
  createRuleId,
  type Rule,
  type RuleAction,
  type RuleCondition,
  type RuleTrigger,
} from "./rule-model";

export type { DueState, DueWhen, Rule, RuleAction, RuleCondition, RuleTrigger } from "./rule-model";

function cloneRules(rules: Rule[]) {
  return structuredClone(rules);
}

export type SyncStatus = "idle" | "loading" | "saving" | "saved" | "draft" | "error";

export interface SyncSnapshot {
  status: SyncStatus;
  filePath: string | null;
  error: string | null;
  runtimeError: string | null;
}

export interface RulesPersistence {
  read: () => Promise<{ path: string; timeZone: string; rules: Rule[] }>;
  save: (request: { rules: Rule[]; deletedIds: string[] }) => Promise<{ path: string }>;
}

export interface RulesStoreScheduler {
  setTimeout: (callback: () => void, delayMs: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface RulesStoreOptions {
  interactionDelayMs?: number;
  effectDurationMs?: number;
  scheduler?: RulesStoreScheduler;
}

export type RuleEffectKind = "moved" | "due-date-changed";

export interface RuleEffect {
  cardId: string;
  revision: number;
  kinds: RuleEffectKind[];
}

const defaultScheduler: RulesStoreScheduler = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const defaultPersistence: RulesPersistence = {
  read: async () => {
    const result = await getRulesFile();
    const parsed = JSON.parse(result.json);
    return {
      path: result.path,
      timeZone: result.timeZone,
      rules: Array.isArray(parsed) ? (parsed as Rule[]) : [],
    };
  },
  save: async ({ rules, deletedIds }) =>
    saveRulesFile({
      data: { json: `${JSON.stringify(rules, null, 2)}\n`, deletedIds },
    }),
};

export class RulesStore {
  private rules: Rule[] = [];
  private lastConfirmed: Rule[] = [];
  private persistedIds = new Set<string>();
  private deletedIds = new Set<string>();
  private listeners = new Set<() => void>();
  private hydrated = false;
  private unsub: (() => void) | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saving = false;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private pendingEvents = new Map<string, BoardEvent[]>();
  private pendingEventTimers = new Map<string, unknown>();
  private cardHolds = new Map<string, number>();
  private effects: Readonly<Record<string, RuleEffect>> = {};
  private effectTimers = new Map<string, unknown>();
  private nextEffectRevision = 1;
  private readonly interactionDelayMs: number;
  private readonly effectDurationMs: number;
  private readonly scheduler: RulesStoreScheduler;
  private timeZone = "UTC";
  private _sync: SyncSnapshot = {
    status: "idle",
    filePath: null,
    error: null,
    runtimeError: null,
  };

  constructor(
    private readonly persistence: RulesPersistence = defaultPersistence,
    private readonly saveDelayMs = 300,
    private readonly boardStore: BoardStore = store,
    private readonly clock: () => Date = () => new Date(),
    options: RulesStoreOptions = {},
  ) {
    this.interactionDelayMs = options.interactionDelayMs ?? 500;
    this.effectDurationMs = options.effectDurationMs ?? 900;
    this.scheduler = options.scheduler ?? defaultScheduler;
  }

  getSyncSnapshot = (): SyncSnapshot => this._sync;
  getEffectsSnapshot = () => this.effects;

  private setSync(patch: Partial<SyncSnapshot>) {
    this._sync = { ...this._sync, ...patch };
  }

  hydrate() {
    if (this.hydrated) return;
    this.hydrated = true;
    this.unsub?.();
    this.unsub = this.boardStore.onEvent((e) => this.handle(e));
    this.setSync({ status: "loading" });
    this.emit();
    void this.reloadFromDisk();
    // The server owns durable midnight reconciliation. This keeps an open UI current too.
    if (typeof window !== "undefined") {
      if (this.sweepTimer) clearInterval(this.sweepTimer);
      this.sweepTimer = setInterval(() => this.reconcileAll(), 60_000);
    }
  }

  async reloadFromDisk() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.clearPendingEvents(true);
    this.deletedIds.clear();
    this.setSync({ status: "loading", error: null });
    this.emit();
    try {
      const res = await this.persistence.read();
      this.timeZone = res.timeZone;
      this.lastConfirmed = cloneRules(res.rules);
      this.rules = cloneRules(res.rules);
      this.persistedIds = new Set(res.rules.map((rule) => rule.id));
      this.setSync({ filePath: res.path, status: "saved", error: null });
      this.reconcileAll();
    } catch (err) {
      this.setSync({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
    this.emit();
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.rules;

  private emit() {
    for (const l of this.listeners) l();
  }

  private persistableRules() {
    return this.rules.filter((rule) => rule.actions.length > 0);
  }

  private hasDrafts() {
    return this.rules.some((rule) => rule.actions.length === 0);
  }

  private hasPersistenceChanges() {
    return (
      this.deletedIds.size > 0 ||
      JSON.stringify(this.persistableRules()) !== JSON.stringify(this.lastConfirmed)
    );
  }

  private set(next: Rule[]) {
    if (this._sync.status === "error") return;
    this.rules = next;
    this.scheduleSave();
    this.emit();
  }

  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.hasPersistenceChanges()) {
      this.setSync({ status: this.hasDrafts() ? "draft" : "saved", error: null });
      return;
    }
    this.setSync({ status: "saving" });
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flushSave();
    }, this.saveDelayMs);
  }

  async flushPendingSave(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    while (this.saving) await new Promise((resolve) => setTimeout(resolve, 10));
    if (this._sync.status === "error" || !this.hasPersistenceChanges()) return;
    await this.flushSave();
  }

  private async flushSave() {
    if (this.saving) {
      this.scheduleSave();
      return;
    }
    this.saving = true;
    const candidate = cloneRules(this.persistableRules());
    const deletedIds = [...this.deletedIds];
    try {
      const res = await this.persistence.save({ rules: candidate, deletedIds });
      this.lastConfirmed = cloneRules(candidate);
      this.persistedIds = new Set(candidate.map((rule) => rule.id));
      for (const id of deletedIds) this.deletedIds.delete(id);
      this.setSync({
        filePath: res.path,
        status: this.hasDrafts() ? "draft" : "saved",
        error: null,
      });
    } catch (err) {
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.saveTimer = null;
      this.rules = cloneRules(this.lastConfirmed);
      this.deletedIds.clear();
      this.setSync({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.saving = false;
      this.emit();
    }
  }

  add(name: string): Rule {
    const board = this.boardStore.getSnapshot();
    const firstCol = board.columns[0]?.id ?? "*";
    const rule: Rule = {
      id: createRuleId(),
      name,
      enabled: false,
      trigger: { kind: "card.created", columnId: firstCol },
      actions: [],
    };
    this.set([...this.rules, rule]);
    return rule;
  }
  update(id: string, patch: Partial<Rule>) {
    if (this.persistedIds.has(id) && patch.actions !== undefined && patch.actions.length === 0)
      return;
    this.set(this.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  remove(id: string) {
    if (this.persistedIds.has(id)) this.deletedIds.add(id);
    this.set(this.rules.filter((r) => r.id !== id));
  }
  toggle(id: string) {
    this.set(
      this.rules.map((r) =>
        r.id === id && r.actions.length > 0 ? { ...r, enabled: !r.enabled } : r,
      ),
    );
  }

  private applyEvents(events: BoardEvent[], publishFeedback = false) {
    if (this.boardStore.isPreviewingMove()) return;
    const before = this.boardStore.getSnapshot();
    const result = applyRuleTransaction({
      board: before,
      rules: this.rules,
      events,
      now: this.clock(),
      timeZone: this.timeZone,
    });
    if (result.diagnostics.length > 0) {
      this.setSync({
        runtimeError: result.diagnostics.map((diagnostic) => diagnostic.message).join(" "),
      });
      this.emit();
      return;
    }
    if (this._sync.runtimeError !== null) {
      this.setSync({ runtimeError: null });
      this.emit();
    }
    if (result.changed) {
      const moved = publishFeedback ? this.publishRuleEffects(before, result.board) : false;
      this.replaceBoard(result.board, moved);
    }
  }

  private clearPendingEvents(preserveHeldCards = false) {
    for (const timer of this.pendingEventTimers.values()) this.scheduler.clearTimeout(timer);
    this.pendingEventTimers.clear();
    if (preserveHeldCards) {
      for (const cardId of this.pendingEvents.keys()) {
        if (!this.cardHolds.has(cardId)) this.pendingEvents.delete(cardId);
      }
    } else {
      this.pendingEvents.clear();
    }
    for (const timer of this.effectTimers.values()) this.scheduler.clearTimeout(timer);
    this.effectTimers.clear();
    this.effects = {};
  }

  private publishRuleEffects(
    before: ReturnType<BoardStore["getSnapshot"]>,
    after: ReturnType<BoardStore["getSnapshot"]>,
  ): boolean {
    const columnByCard = (board: ReturnType<BoardStore["getSnapshot"]>, cardId: string) =>
      board.columns.find((column) => column.cardIds.includes(cardId))?.id ?? null;
    const changedEffects: Array<{ cardId: string; kinds: RuleEffectKind[] }> = [];

    for (const cardId of new Set([...Object.keys(before.cards), ...Object.keys(after.cards)])) {
      const beforeCard = before.cards[cardId];
      const afterCard = after.cards[cardId];
      if (!beforeCard || !afterCard) continue;

      const kinds: RuleEffectKind[] = [];
      if (columnByCard(before, cardId) !== columnByCard(after, cardId)) kinds.push("moved");
      if (beforeCard.dueDate !== afterCard.dueDate) kinds.push("due-date-changed");
      if (kinds.length > 0) changedEffects.push({ cardId, kinds });
    }

    if (changedEffects.length === 0) return false;

    const nextEffects = { ...this.effects };
    for (const { cardId, kinds } of changedEffects) {
      const previousTimer = this.effectTimers.get(cardId);
      if (previousTimer !== undefined) this.scheduler.clearTimeout(previousTimer);

      const effect: RuleEffect = {
        cardId,
        revision: this.nextEffectRevision++,
        kinds,
      };
      nextEffects[cardId] = effect;
      const timer = this.scheduler.setTimeout(() => {
        if (this.effects[cardId]?.revision !== effect.revision) return;
        const remaining = { ...this.effects };
        delete remaining[cardId];
        this.effects = remaining;
        this.effectTimers.delete(cardId);
        this.emit();
      }, this.effectDurationMs);
      this.effectTimers.set(cardId, timer);
    }
    this.effects = nextEffects;
    this.emit();
    return changedEffects.some((effect) => effect.kinds.includes("moved"));
  }

  private replaceBoard(next: ReturnType<BoardStore["getSnapshot"]>, animateMove: boolean) {
    const viewTransitionDocument =
      typeof document === "undefined"
        ? null
        : (document as Document & {
            startViewTransition?: (update: () => void) => unknown;
          });
    const reducedMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (
      animateMove &&
      !reducedMotion &&
      typeof viewTransitionDocument?.startViewTransition === "function"
    ) {
      try {
        viewTransitionDocument.startViewTransition(() =>
          flushSync(() => this.boardStore.replace(next)),
        );
        return;
      } catch {
        // Fall through to the direct update when the browser rejects a transition.
      }
    }
    this.boardStore.replace(next);
  }

  private drainCardEvents(cardId: string) {
    const timer = this.pendingEventTimers.get(cardId);
    if (timer !== undefined) this.scheduler.clearTimeout(timer);
    this.pendingEventTimers.delete(cardId);

    const events = this.pendingEvents.get(cardId);
    this.pendingEvents.delete(cardId);
    if (!events || events.length === 0) return;
    this.applyEvents(events, true);
  }

  private scheduleCardEvents(cardId: string) {
    if ((this.cardHolds.get(cardId) ?? 0) > 0) return;

    const previousTimer = this.pendingEventTimers.get(cardId);
    if (previousTimer !== undefined) this.scheduler.clearTimeout(previousTimer);
    this.pendingEventTimers.delete(cardId);

    if (this.interactionDelayMs <= 0) {
      this.drainCardEvents(cardId);
      return;
    }

    const timer = this.scheduler.setTimeout(
      () => this.drainCardEvents(cardId),
      this.interactionDelayMs,
    );
    this.pendingEventTimers.set(cardId, timer);
  }

  holdCard(cardId: string) {
    this.cardHolds.set(cardId, (this.cardHolds.get(cardId) ?? 0) + 1);
    const timer = this.pendingEventTimers.get(cardId);
    if (timer !== undefined) {
      this.scheduler.clearTimeout(timer);
      this.pendingEventTimers.delete(cardId);
    }
  }

  releaseCard(cardId: string) {
    const count = this.cardHolds.get(cardId) ?? 0;
    if (count === 0) return;
    if (count > 1) {
      this.cardHolds.set(cardId, count - 1);
      return;
    }

    this.cardHolds.delete(cardId);
    if (this.pendingEvents.has(cardId)) this.scheduleCardEvents(cardId);
  }

  private reconcileAll() {
    this.applyEvents(
      Object.values(this.boardStore.getSnapshot().cards)
        .filter((card) => !this.cardHolds.has(card.id))
        .flatMap((card) => [
          ...(card.completed
            ? [{ kind: "card.completed" as const, cardId: card.id, completed: true as const }]
            : []),
          { kind: "card.dueStateChanged" as const, cardId: card.id },
        ]),
    );
  }

  private handle(event: BoardEvent) {
    const events = this.pendingEvents.get(event.cardId) ?? [];
    this.pendingEvents.set(event.cardId, [...events, event]);
    this.scheduleCardEvents(event.cardId);
  }
}

export const rulesStore = new RulesStore();

export function useRules(): Rule[] {
  return useSyncExternalStore(rulesStore.subscribe, rulesStore.getSnapshot, rulesStore.getSnapshot);
}

export function useRulesSync(): SyncSnapshot {
  return useSyncExternalStore(
    rulesStore.subscribe,
    rulesStore.getSyncSnapshot,
    rulesStore.getSyncSnapshot,
  );
}

export function useRuleEffects(): Readonly<Record<string, RuleEffect>> {
  return useSyncExternalStore(
    rulesStore.subscribe,
    rulesStore.getEffectsSnapshot,
    rulesStore.getEffectsSnapshot,
  );
}

export function describeTrigger(t: RuleTrigger, colName: (id: string) => string): string {
  switch (t.kind) {
    case "card.created":
      return `When a card is created in ${t.columnId === "*" ? "any column" : colName(t.columnId)}`;
    case "card.moved":
      return `When a card is moved to ${colName(t.toColumnId)}`;
    case "card.completed":
      return t.value ? "When a card is marked complete" : "When a card is reopened";
    case "card.dueOn":
      return t.when === "today"
        ? "When a card's due date is today"
        : t.when === "tomorrow"
          ? "When a card's due date is tomorrow"
          : "When a card is overdue";
    case "card.dueStateChanged":
      return "When a card's due-date state is evaluated";
  }
}

export function describeAction(
  a: RuleAction,
  colName: (id: string) => string,
  tagName: (id: string) => string,
): string {
  switch (a.kind) {
    case "setDueDate":
      if (a.offsetDays === 0) return "Set due date to today";
      if (a.offsetDays === 1) return "Set due date to tomorrow";
      if (a.offsetDays > 0) return `Set due date to +${a.offsetDays} days`;
      return `Set due date to ${a.offsetDays} days`;
    case "clearDueDate":
      return "Clear due date";
    case "addTag":
      return `Add tag "${tagName(a.tagId)}"`;
    case "removeTag":
      return `Remove tag "${tagName(a.tagId)}"`;
    case "moveToColumn":
      return `Move to ${colName(a.columnId)}`;
    case "setCompleted":
      return a.value ? "Mark complete" : "Mark open";
    case "sortByDueDate":
      return "Sort every column by due date";
    case "archiveCard":
      return "Archive card";
  }
}

export function describeCondition(
  condition: RuleCondition,
  colName: (id: string) => string,
  tagName: (id: string) => string,
): string {
  switch (condition.kind) {
    case "column": {
      const names = condition.columnIds.map(colName).join(", ");
      return condition.operator === "in" ? `Column is ${names}` : `Column is not ${names}`;
    }
    case "tag":
      return `Has tag "${tagName(condition.tagId)}"`;
    case "completed":
      return condition.value ? "Card is complete" : "Card is open";
    case "dueState":
      return condition.value === "none"
        ? "Has no due date"
        : condition.value === "future"
          ? "Due later than tomorrow"
          : `Due state is ${condition.value}`;
    case "createdAgeDays":
      return `Created at least ${condition.value} days ago`;
    case "completedAgeDays":
      return `Completed at least ${condition.value} days ago`;
  }
}
