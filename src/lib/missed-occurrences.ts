import type { PendingSeries } from "./workspace/schedule-state";

export type OccurrenceDecision = "repeat" | "skip" | "repeat_series" | "decline_series";

export interface QueueItem {
  ruleId: string;
  ruleName: string;
  /** The occurrence being asked about; the first of the series when collapsed. */
  occurrence: string;
  /** Rendered card title, or an empty string for a collapsed series. */
  preview: string;
  collapsed: boolean;
  /** How many occurrences of this rule the answer will cover, when collapsed. */
  seriesCount: number;
  seriesStart: string;
  seriesEnd: string;
}

const DECISION_LABELS: [OccurrenceDecision, string][] = [
  ["repeat", "Create it"],
  ["skip", "Skip it"],
  ["repeat_series", "Create the whole series"],
  ["decline_series", "Skip the whole series"],
];

export function occurrenceDecisionOptions(collapsed: boolean): [OccurrenceDecision, string][] {
  return collapsed
    ? [
        ["repeat_series", "Create them all"],
        ["decline_series", "Skip them all"],
      ]
    : DECISION_LABELS;
}

/** The decision that Enter applies, so the common answer costs one keystroke. */
export const DEFAULT_DECISION: OccurrenceDecision = "repeat";

export function defaultDecisionFor(item: QueueItem): OccurrenceDecision {
  return item.collapsed ? "repeat_series" : DEFAULT_DECISION;
}

/**
 * Flattens the server's per-rule series into the one-question-at-a-time queue
 * the dialog walks through. A collapsed series contributes a single question.
 */
export function queueFromSeries(series: PendingSeries[]): QueueItem[] {
  return series.flatMap((entry) => {
    if (entry.occurrences.length === 0) return [];
    const seriesStart = entry.occurrences[0];
    const seriesEnd = entry.occurrences[entry.occurrences.length - 1];
    const shared = {
      ruleId: entry.ruleId,
      ruleName: entry.ruleName,
      collapsed: entry.collapsed,
      seriesCount: entry.occurrences.length,
      seriesStart,
      seriesEnd,
    };
    if (entry.collapsed) return [{ ...shared, occurrence: seriesStart, preview: "" }];
    return entry.occurrences.map((occurrence, index) => ({
      ...shared,
      occurrence,
      preview: entry.previews[index] ?? "",
    }));
  });
}

/** Removes whatever the answer settled: one occurrence, or a rule's whole series. */
export function advanceQueue(
  queue: QueueItem[],
  answered: QueueItem,
  decision: OccurrenceDecision,
): QueueItem[] {
  if (decision === "repeat_series" || decision === "decline_series")
    return queue.filter((item) => item.ruleId !== answered.ruleId);
  return queue.filter(
    (item) => !(item.ruleId === answered.ruleId && item.occurrence === answered.occurrence),
  );
}

export function describeQueueItem(item: QueueItem, formatDate: (iso: string) => string): string {
  if (item.collapsed)
    return `${item.ruleName} missed ${item.seriesCount} runs between ${formatDate(
      item.seriesStart,
    )} and ${formatDate(item.seriesEnd)}.`;
  return `${item.ruleName} was due to create a card on ${formatDate(item.occurrence)}.`;
}

// ---------------------------------------------------------------------------
// Client store
// ---------------------------------------------------------------------------

export interface OccurrencesPersistence {
  read: () => Promise<{ series: PendingSeries[] }>;
  resolve: (request: {
    ruleId: string;
    occurrence: string;
    decision: OccurrenceDecision;
  }) => Promise<{ created: string[] }>;
}

export interface OccurrencesSnapshot {
  queue: QueueItem[];
  busy: boolean;
  error: string | null;
}

export class MissedOccurrencesStore {
  private snapshot: OccurrencesSnapshot = { queue: [], busy: false, error: null };
  private listeners = new Set<() => void>();
  private hydrated = false;

  constructor(
    private readonly persistence: OccurrencesPersistence,
    private readonly onResolved: () => void = () => {},
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.snapshot;

  private set(patch: Partial<OccurrencesSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  hydrate() {
    if (this.hydrated) return;
    this.hydrated = true;
    void this.reload();
  }

  async reload() {
    try {
      const { series } = await this.persistence.read();
      this.set({ queue: queueFromSeries(series), error: null });
    } catch (error) {
      this.set({ error: error instanceof Error ? error.message : String(error) });
    }
  }

  /** Defers every remaining question to the next time the board is opened. */
  dismiss() {
    this.set({ queue: [] });
  }

  async answer(item: QueueItem, decision: OccurrenceDecision) {
    if (this.snapshot.busy) return;
    this.set({ busy: true, error: null });
    try {
      const { created } = await this.persistence.resolve({
        ruleId: item.ruleId,
        occurrence: item.occurrence,
        decision,
      });
      this.set({ queue: advanceQueue(this.snapshot.queue, item, decision), busy: false });
      if (created.length > 0) this.onResolved();
    } catch (error) {
      this.set({
        busy: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
