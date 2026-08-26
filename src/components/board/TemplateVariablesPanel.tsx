import { Braces } from "lucide-react";

import { templateVariableRows } from "@/lib/templates-ui";
import type { ExpressionContext } from "@/lib/template-expression";

/**
 * Occupies the place comments hold on a real card. A template has no
 * conversation; what it needs instead is a reminder of what it can say.
 */
export function TemplateVariablesPanel({ context }: { context: ExpressionContext }) {
  const rows = templateVariableRows(context);
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground mb-2">
        <Braces size={13} />
        Variables
        <span className="text-subtle-foreground font-normal">
          shown as they would resolve right now
        </span>
      </div>
      <div className="rounded-md border border-border divide-y divide-border overflow-hidden">
        {rows.map((row) => (
          <div key={row.expression} className="flex items-baseline gap-3 px-2.5 py-1.5 text-xs">
            <code className="font-mono text-primary shrink-0">{row.expression}</code>
            <span className="text-subtle-foreground shrink-0">{row.description}</span>
            <span className="ml-auto text-foreground/80 truncate">{row.preview}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-subtle-foreground">
        Shift a date with <code className="font-mono">+2d</code>,{" "}
        <code className="font-mono">-1w</code>, or <code className="font-mono">+1m</code>, and
        format it with <code className="font-mono">:long</code>,{" "}
        <code className="font-mono">:short</code>, <code className="font-mono">:full</code>,{" "}
        <code className="font-mono">:weekday</code>, <code className="font-mono">:day</code>,{" "}
        <code className="font-mono">:month</code>, or <code className="font-mono">:year</code> — for
        example <code className="font-mono">{"{{date+2d:long}}"}</code>.
      </p>
    </div>
  );
}
