import { HardDrive } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useRulesSync } from "@/lib/rules";
import { useBoardSync } from "@/lib/store";

export function StorageInfo() {
  const rulesSync = useRulesSync();
  const boardSync = useBoardSync();

  const fmt = (s: { status: string; error: string | null; lastSyncedAt?: string | null }) => {
    if (s.status === "saving") return "saving…";
    if (s.status === "loading") return "loading…";
    if (s.status === "error") return `error: ${s.error ?? "unknown"}`;
    if (s.lastSyncedAt) return `saved · ${new Date(s.lastSyncedAt).toLocaleTimeString()}`;
    return "saved";
  };

  const entries: { label: string; path: string; kind: "file" | "browser"; status?: string }[] = [
    {
      label: "Board",
      path: boardSync.filePath ? `${boardSync.filePath}/flowmark.yaml` : "flowmark.yaml",
      kind: "file",
      status: fmt(boardSync),
    },
    {
      label: "Rules",
      path: rulesSync.filePath ?? "rules/",
      kind: "file",
      status: fmt({ ...rulesSync, lastSyncedAt: null }),
    },
  ];

  return (
    <Popover>
      <PopoverTrigger
        className="inline-flex items-center gap-1 text-[11px] text-subtle-foreground hover:text-foreground"
        title="Where your data is stored"
      >
        <HardDrive size={11} /> Storage
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-[320px] p-0 bg-popover border-border">
        <div className="px-3 py-2 border-b border-border">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Persisted data
          </div>
        </div>
        <ul className="p-2 space-y-1.5">
          {entries.map((e) => (
            <li
              key={e.label}
              className="flex flex-col gap-0.5 rounded-md px-2 py-1.5 bg-surface-sunken/60 border border-border"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium">{e.label}</span>
                <span
                  className={`text-[10px] uppercase tracking-wide ${
                    e.kind === "file" ? "text-primary" : "text-subtle-foreground"
                  }`}
                >
                  {e.kind}
                </span>
              </div>
              <code className="text-[11px] text-muted-foreground font-mono break-all">
                {e.path}
              </code>
              {e.status && <span className="text-[10px] text-subtle-foreground">{e.status}</span>}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
