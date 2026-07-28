export type DueState = "overdue" | "today" | "tomorrow" | "upcoming" | "none";

function startOfDay(d: Date) {
  const n = new Date(d);
  n.setHours(0, 0, 0, 0);
  return n;
}

export function dueState(iso: string | null): DueState {
  if (!iso) return "none";
  const today = startOfDay(new Date());
  const due = startOfDay(new Date(iso));
  const diff = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  return "upcoming";
}

export function formatDue(iso: string | null): string {
  if (!iso) return "No date";
  const s = dueState(iso);
  const d = new Date(iso);
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
  };
  if (s === "today") return "Today";
  if (s === "tomorrow") return "Tomorrow";
  if (s === "overdue") {
    const today = startOfDay(new Date());
    const due = startOfDay(d);
    const diff = Math.round((today.getTime() - due.getTime()) / 86400000);
    if (diff === 1) return "Yesterday";
    if (diff < 7) return `${diff}d overdue`;
    return d.toLocaleDateString(undefined, opts);
  }
  return d.toLocaleDateString(undefined, opts);
}

export const dueColorVar: Record<DueState, string> = {
  overdue: "var(--due-overdue)",
  today: "var(--due-today)",
  tomorrow: "var(--due-tomorrow)",
  upcoming: "var(--due-upcoming)",
  none: "var(--due-none)",
};
