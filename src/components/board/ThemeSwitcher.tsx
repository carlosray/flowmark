import { useState } from "react";
import { Check, Palette } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { persistThemeSelection } from "@/lib/theme-selection";
import { saveWorkspaceTheme } from "@/lib/theme.functions";
import { THEMES, applyTheme, type ThemeId } from "@/lib/themes";

export function ThemeOptions({
  current,
  error,
  saving = false,
  onSelect,
}: {
  current: ThemeId;
  error: string | null;
  saving?: boolean;
  onSelect: (theme: ThemeId) => void;
}) {
  return (
    <>
      <div className="px-2 py-1.5 text-[11px] uppercase tracking-wide text-subtle-foreground">
        Workspace theme
      </div>
      <div className="space-y-0.5">
        {THEMES.map((theme) => {
          const active = theme.id === current;
          return (
            <button
              key={theme.id}
              type="button"
              disabled={saving}
              aria-pressed={active}
              onClick={() => onSelect(theme.id)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left hover:bg-accent disabled:opacity-50 ${active ? "bg-accent" : ""}`}
            >
              <span
                className="inline-flex h-5 w-10 shrink-0 overflow-hidden rounded-md border border-border"
                aria-hidden="true"
              >
                {theme.swatch.map((color) => (
                  <span key={color} className="h-full w-2.5" style={{ background: color }} />
                ))}
              </span>
              <span className="flex-1 truncate">{theme.label}</span>
              {active && <Check size={14} className="shrink-0 text-primary" />}
            </button>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="mx-2 mt-2 border-t border-danger/30 pt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </>
  );
}

export function ThemeSwitcher({ initialTheme }: { initialTheme: ThemeId }) {
  const [current, setCurrent] = useState<ThemeId>(initialTheme);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeTheme = THEMES.find((theme) => theme.id === current) ?? THEMES[0];

  async function pick(next: ThemeId) {
    if (saving || next === current) return;
    const previous = current;
    setCurrent(next);
    setError(null);
    setSaving(true);
    const result = await persistThemeSelection({
      previous,
      next,
      apply: applyTheme,
      save: async (theme) => {
        await saveWorkspaceTheme({ data: { theme } });
      },
    });
    setCurrent(result.theme);
    setError(result.error);
    setSaving(false);
    if (!result.error) setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="h-8 shrink-0 inline-flex items-center gap-1.5 px-2.5 rounded-md text-xs text-muted-foreground bg-surface-sunken border border-border hover:text-foreground hover:border-border-strong"
          title="Change workspace theme"
        >
          <Palette size={13} />
          <span className="hidden sm:inline">{activeTheme.label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1.5">
        <ThemeOptions current={current} error={error} saving={saving} onSelect={pick} />
      </PopoverContent>
    </Popover>
  );
}
