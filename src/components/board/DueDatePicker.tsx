import { useState } from "react";
import { CalendarDays, X } from "lucide-react";

import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { dateFromCalendarDate, dateToCalendarDate } from "@/lib/calendar-date";

function formatDate(value: string, month: "short" | "long") {
  const date = dateFromCalendarDate(value);
  return date
    ? new Intl.DateTimeFormat("en-US", { month, day: "numeric", year: "numeric" }).format(date)
    : value;
}

export function DueDatePicker({
  dueDate,
  onChange,
}: {
  dueDate: string | null;
  onChange: (dueDate: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = dateFromCalendarDate(dueDate);
  const label = dueDate ? formatDate(dueDate, "short") : "Due date";
  const accessibleLabel = dueDate
    ? `Change due date, ${formatDate(dueDate, "long")}`
    : "Set due date";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={accessibleLabel}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-transparent px-2 text-xs text-muted-foreground transition-colors hover:border-border-strong hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <CalendarDays size={12} aria-hidden="true" />
          <span>{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto overflow-hidden rounded-xl p-0 shadow-xl">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(date) => {
            if (!date) return;
            onChange(dateToCalendarDate(date));
            setOpen(false);
          }}
          autoFocus
        />
        {dueDate && (
          <div className="flex justify-end border-t border-border px-3 py-2">
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <X size={12} aria-hidden="true" />
              Clear
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
