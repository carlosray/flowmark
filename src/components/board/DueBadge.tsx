import { dueColorVar, dueState, formatDue } from "@/lib/due";
import { Calendar } from "lucide-react";

export function DueBadge({ iso }: { iso: string | null }) {
  if (!iso) return null;
  const s = dueState(iso);
  const color = dueColorVar[s];
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded"
      style={{
        color,
        background: `color-mix(in oklab, ${color} 12%, transparent)`,
        border: `1px solid color-mix(in oklab, ${color} 22%, transparent)`,
      }}
    >
      <Calendar size={11} />
      {formatDue(iso)}
    </span>
  );
}
