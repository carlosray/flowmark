import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { CalendarClock } from "lucide-react";

import { store } from "@/lib/store";
import {
  MissedOccurrencesStore,
  defaultDecisionFor,
  describeQueueItem,
  occurrenceDecisionOptions,
  type OccurrenceDecision,
} from "@/lib/missed-occurrences";
import { getPendingOccurrences, resolvePendingOccurrence } from "@/lib/schedule.functions";

const missedOccurrencesStore = new MissedOccurrencesStore(
  {
    read: () => getPendingOccurrences(),
    resolve: (data) => resolvePendingOccurrence({ data }),
  },
  () => void store.reloadFromDisk(),
);

function formatOccurrence(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

/**
 * Asks about runs that happened while Flowmark was not running. One question at
 * a time, with the common answer on Enter; Escape defers the rest rather than
 * declining them, so nothing is lost by closing the board.
 */
export function MissedOccurrencesDialog() {
  const snapshot = useSyncExternalStore(
    missedOccurrencesStore.subscribe,
    missedOccurrencesStore.getSnapshot,
    missedOccurrencesStore.getSnapshot,
  );
  const defaultButton = useRef<HTMLButtonElement>(null);
  const item = snapshot.queue[0];

  useEffect(() => {
    missedOccurrencesStore.hydrate();
  }, []);

  useEffect(() => {
    if (!item) return;
    defaultButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") missedOccurrencesStore.dismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [item]);

  if (!item) return null;

  const preferred = defaultDecisionFor(item);
  const answer = (decision: OccurrenceDecision) =>
    void missedOccurrencesStore.answer(item, decision);

  return createPortal(
    <div className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-popover border border-border rounded-xl shadow-2xl">
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border">
          <CalendarClock size={15} className="text-primary" />
          <h2 className="text-sm font-semibold">Missed while you were away</h2>
          {snapshot.queue.length > 1 && (
            <span className="ml-auto text-[11px] text-subtle-foreground">
              {snapshot.queue.length} left
            </span>
          )}
        </div>

        <div className="px-5 py-4 space-y-2">
          <p className="text-sm text-foreground/90">{describeQueueItem(item, formatOccurrence)}</p>
          {item.preview && (
            <p className="text-sm text-subtle-foreground">
              It would create <span className="text-foreground/80">{item.preview}</span>.
            </p>
          )}
          {snapshot.error && <p className="text-[11px] text-danger">{snapshot.error}</p>}
        </div>

        <div className="border-t border-border px-4 py-3 flex flex-wrap items-center justify-end gap-2">
          {occurrenceDecisionOptions(item.collapsed).map(([decision, label]) => (
            <button
              key={decision}
              ref={decision === preferred ? defaultButton : undefined}
              disabled={snapshot.busy}
              onClick={() => answer(decision)}
              className={
                decision === preferred
                  ? "text-xs bg-primary text-primary-foreground rounded-md px-3 py-1.5 disabled:opacity-40"
                  : "text-xs text-muted-foreground hover:text-foreground px-2.5 py-1.5 rounded-md hover:bg-accent disabled:opacity-40"
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
