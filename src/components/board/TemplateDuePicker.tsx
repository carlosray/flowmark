import { DueDatePicker } from "./DueDatePicker";
import { templateDueModeOptions, withDueMode } from "@/lib/templates-ui";
import { dateToCalendarDate } from "@/lib/calendar-date";
import type { TemplateDue } from "@/lib/templates";

const OFFSET_OPTIONS: [string, string][] = [
  ["-1", "the day before"],
  ["0", "the same day"],
  ["1", "the next day"],
  ["2", "2 days later"],
  ["3", "3 days later"],
  ["7", "a week later"],
  ["14", "2 weeks later"],
  ["30", "30 days later"],
];

/**
 * A template's due date is a rule, not a date, so the picker chooses between
 * having none, counting from creation, and pinning one calendar day.
 */
export function TemplateDuePicker({
  due,
  onChange,
}: {
  due: TemplateDue;
  onChange: (due: TemplateDue) => void;
}) {
  const today = dateToCalendarDate(new Date());
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        aria-label="Due date mode"
        value={due.mode}
        onChange={(event) =>
          onChange(withDueMode(due, event.target.value as TemplateDue["mode"], today))
        }
        className="text-xs bg-surface border border-border rounded-md px-2 py-1 text-foreground/90 outline-none focus:border-primary/60 cursor-pointer"
      >
        {templateDueModeOptions().map(([mode, label]) => (
          <option key={mode} value={mode} className="bg-popover">
            {label}
          </option>
        ))}
      </select>
      {due.mode === "offset" && (
        <select
          aria-label="Days from creation"
          value={String(due.offsetDays)}
          onChange={(event) => onChange({ mode: "offset", offsetDays: Number(event.target.value) })}
          className="text-xs bg-surface border border-border rounded-md px-2 py-1 text-foreground/90 outline-none focus:border-primary/60 cursor-pointer"
        >
          {OFFSET_OPTIONS.map(([value, label]) => (
            <option key={value} value={value} className="bg-popover">
              {label}
            </option>
          ))}
        </select>
      )}
      {due.mode === "fixed" && (
        <DueDatePicker
          dueDate={due.date === "" ? null : due.date}
          onChange={(value) => onChange({ mode: "fixed", date: value ?? today })}
        />
      )}
    </div>
  );
}
