import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Trash2, Zap, X, Power } from "lucide-react";
import { useBoard } from "@/lib/store";
import {
  rulesStore,
  useRules,
  useRulesSync,
  describeAction,
  describeCondition,
  describeTrigger,
  type Rule,
  type RuleAction,
  type RuleCondition,
  type RuleTrigger,
  type DueState,
} from "@/lib/rules";
import {
  closeRulesModal,
  prepareRulesModalOpen,
  ruleActionOptions,
  ruleConditionOptions,
  ruleDueStateOptions,
  ruleTriggerOptions,
} from "@/lib/rules-ui";

export function RulesButton() {
  const [open, setOpen] = useState(false);
  const rules = useRules();
  const sync = useRulesSync();
  const enabledCount = rules.filter((r) => r.enabled).length;

  useEffect(() => {
    rulesStore.hydrate();
  }, []);

  return (
    <>
      <button
        onClick={() => {
          void prepareRulesModalOpen({
            hasPersistenceError: () => sync.status === "error",
            reloadFromDisk: () => rulesStore.reloadFromDisk(),
          }).then(() => setOpen(true));
        }}
        className="inline-flex items-center gap-1.5 h-8 text-xs bg-surface-sunken border border-border rounded-md px-2.5 hover:bg-accent"
        title="Automation rules"
      >
        <Zap size={12} className={enabledCount > 0 ? "text-primary" : "text-muted-foreground"} />
        Rules
        {enabledCount > 0 && (
          <span className="text-[10px] text-subtle-foreground">· {enabledCount}</span>
        )}
      </button>
      {open && createPortal(<RulesModal onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function RulesModal({ onClose }: { onClose: () => void }) {
  const rules = useRules();
  const board = useBoard();
  const sync = useRulesSync();
  const closingRef = useRef(false);
  const colName = (id: string) =>
    board.columns.find((c) => c.id === id)?.name ?? "(unknown column)";
  const tagName = (id: string) => board.tags.find((t) => t.id === id)?.name ?? "(unknown tag)";

  const statusLabel =
    sync.runtimeError !== null
      ? `Automation error: ${sync.runtimeError}`
      : sync.status === "loading"
        ? "Loading…"
        : sync.status === "saving"
          ? "Saving…"
          : sync.status === "draft"
            ? "Draft · add an action to save"
            : sync.status === "error"
              ? `Error: ${sync.error ?? "unknown"}`
              : sync.status === "saved"
                ? "Saved"
                : "";

  async function requestClose() {
    if (closingRef.current) return;
    closingRef.current = true;
    await closeRulesModal({
      flushPendingSave: () => rulesStore.flushPendingSave(),
      onClose,
    });
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") void requestClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  return (
    <div
      className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm flex items-start justify-center p-6 overflow-y-auto"
      onClick={() => void requestClose()}
    >
      <div
        className="w-full max-w-2xl bg-popover border border-border rounded-xl shadow-2xl mt-8 mb-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border">
          <Zap size={15} className="text-primary" />
          <h2 className="text-sm font-semibold">Automation rules</h2>
          <span className="text-[11px] text-subtle-foreground">
            Run actions automatically when cards change
          </span>
          <button
            onClick={() => void requestClose()}
            className="ml-auto text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-accent"
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-4 space-y-2 max-h-[70vh] overflow-y-auto">
          {rules.length === 0 && (
            <div className="text-center py-10 text-sm text-muted-foreground">
              No rules yet. Automate repetitive edits like "when a card lands in <em>Today</em>, set
              due date to today."
            </div>
          )}
          {rules.map((rule) => (
            <RuleRow key={rule.id} rule={rule} board={board} colName={colName} tagName={tagName} />
          ))}
        </div>

        <div className="border-t border-border px-4 py-3 flex items-center justify-between gap-3">
          <span
            className={`text-[11px] ${
              sync.status === "error" || sync.runtimeError !== null
                ? "text-danger"
                : "text-subtle-foreground"
            }`}
          >
            {statusLabel || "Persisted to file"}
          </span>
          <button
            onClick={() => rulesStore.add("New rule")}
            className="inline-flex items-center gap-1.5 text-xs bg-primary text-primary-foreground rounded-md px-3 py-1.5 hover:opacity-90"
          >
            <Plus size={12} /> New rule
          </button>
        </div>
      </div>
    </div>
  );
}

function RuleRow({
  rule,
  board,
  colName,
  tagName,
}: {
  rule: Rule;
  board: ReturnType<typeof useBoard>;
  colName: (id: string) => string;
  tagName: (id: string) => string;
}) {
  const [expanded, setExpanded] = useState(rule.actions.length === 0);
  const isDraft = rule.actions.length === 0;

  return (
    <div className="border border-border rounded-lg bg-surface-sunken/40">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={() => rulesStore.toggle(rule.id)}
          disabled={isDraft}
          aria-pressed={rule.enabled}
          className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition ${
            rule.enabled
              ? "border-primary/30 bg-primary/10 text-primary"
              : isDraft
                ? "cursor-not-allowed border-border text-disabled"
                : "border-border text-muted-foreground hover:border-border-strong hover:bg-accent hover:text-foreground"
          }`}
          title={
            isDraft
              ? "Add an action before enabling this rule"
              : rule.enabled
                ? "Enabled"
                : "Disabled"
          }
        >
          <Power size={12} />
          {rule.enabled ? "Enabled" : "Disabled"}
        </button>
        <input
          value={rule.name}
          onChange={(e) => rulesStore.update(rule.id, { name: e.target.value })}
          className="bg-transparent text-sm font-medium outline-none focus:ring-1 focus:ring-primary/40 rounded px-1 flex-1"
        />
        {isDraft && (
          <span className="text-[10px] font-medium text-warning">Draft · add an action</span>
        )}
        <button
          onClick={() => setExpanded((x) => !x)}
          className="text-[11px] text-muted-foreground hover:text-foreground px-2 py-0.5"
        >
          {expanded ? "Collapse" : "Edit"}
        </button>
        <button
          onClick={() => {
            if (confirm(`Delete rule "${rule.name}"?`)) rulesStore.remove(rule.id);
          }}
          className="text-muted-foreground hover:text-danger p-1 rounded-md hover:bg-accent"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {!expanded && (
        <div className="px-3 pb-2.5 text-[12px] text-muted-foreground space-y-0.5">
          <div>
            <span className="text-subtle-foreground">Trigger · </span>
            {describeTrigger(rule.trigger, colName)}
          </div>
          {(rule.conditions ?? []).map((condition, index) => (
            <div key={index}>
              <span className="text-subtle-foreground">If · </span>
              {describeCondition(condition, colName, tagName)}
            </div>
          ))}
          {rule.actions.length === 0 ? (
            <div className="italic text-subtle-foreground">No actions configured</div>
          ) : (
            rule.actions.map((a, i) => (
              <div key={i}>
                <span className="text-subtle-foreground">Then · </span>
                {describeAction(a, colName, tagName)}
              </div>
            ))
          )}
        </div>
      )}

      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-border/50 pt-3">
          <TriggerEditor rule={rule} board={board} />
          <ConditionsEditor rule={rule} board={board} />
          <ActionsEditor rule={rule} board={board} />
        </div>
      )}
    </div>
  );
}

function TriggerEditor({ rule, board }: { rule: Rule; board: ReturnType<typeof useBoard> }) {
  const t = rule.trigger;
  const setTrigger = (trigger: RuleTrigger) => rulesStore.update(rule.id, { trigger });

  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-subtle-foreground mb-1.5">When</div>
      <div className="flex flex-wrap items-center gap-1.5">
        <SelectPill
          value={t.kind}
          onChange={(v) => {
            if (v === "card.created") setTrigger({ kind: "card.created", columnId: "*" });
            else if (v === "card.moved")
              setTrigger({
                kind: "card.moved",
                toColumnId: board.columns[0]?.id ?? "",
              });
            else if (v === "card.dueOn") setTrigger({ kind: "card.dueOn", when: "today" });
            else if (v === "card.dueStateChanged") setTrigger({ kind: "card.dueStateChanged" });
            else setTrigger({ kind: "card.completed", value: true });
          }}
          options={ruleTriggerOptions()}
        />
        {t.kind === "card.created" && (
          <>
            <span className="text-[11px] text-subtle-foreground">in</span>
            <SelectPill
              value={t.columnId}
              onChange={(v) => setTrigger({ kind: "card.created", columnId: v })}
              options={[
                ["*", "any column"],
                ...board.columns.map<[string, string]>((c) => [c.id, c.name]),
              ]}
            />
          </>
        )}
        {t.kind === "card.moved" && (
          <>
            <span className="text-[11px] text-subtle-foreground">to</span>
            <SelectPill
              value={t.toColumnId}
              onChange={(v) => setTrigger({ kind: "card.moved", toColumnId: v })}
              options={board.columns.map<[string, string]>((c) => [c.id, c.name])}
            />
          </>
        )}
        {t.kind === "card.dueOn" && (
          <SelectPill
            value={t.when}
            onChange={(v) =>
              setTrigger({ kind: "card.dueOn", when: v as "overdue" | "today" | "tomorrow" })
            }
            options={[
              ["today", "today"],
              ["tomorrow", "tomorrow"],
              ["overdue", "overdue"],
            ]}
          />
        )}
        {t.kind === "card.completed" && (
          <SelectPill
            value={t.value ? "1" : "0"}
            onChange={(v) => setTrigger({ kind: "card.completed", value: v === "1" })}
            options={[
              ["1", "to complete"],
              ["0", "to open"],
            ]}
          />
        )}
      </div>
    </div>
  );
}

function ConditionsEditor({ rule, board }: { rule: Rule; board: ReturnType<typeof useBoard> }) {
  const conditions = rule.conditions ?? [];
  const setConditions = (next: RuleCondition[]) => rulesStore.update(rule.id, { conditions: next });
  const firstColumnId = board.columns[0]?.id ?? "";
  const firstTagId = board.tags[0]?.id ?? "";

  const makeCondition = (kind: RuleCondition["kind"]): RuleCondition => {
    switch (kind) {
      case "column":
        return { kind: "column", operator: "in", columnIds: [firstColumnId] };
      case "tag":
        return { kind: "tag", tagId: firstTagId };
      case "completed":
        return { kind: "completed", value: false };
      case "dueState":
        return { kind: "dueState", value: "none" };
      case "createdAgeDays":
        return { kind: "createdAgeDays", value: 30 };
      case "completedAgeDays":
        return { kind: "completedAgeDays", value: 30 };
    }
  };

  const updateCondition = (index: number, condition: RuleCondition) => {
    setConditions(
      conditions.map((current, currentIndex) => (currentIndex === index ? condition : current)),
    );
  };

  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-subtle-foreground mb-1.5">
        If (all)
      </div>
      <div className="space-y-1.5">
        {conditions.map((condition, index) => (
          <div key={index} className="flex flex-wrap items-center gap-1.5">
            <SelectPill
              ariaLabel="Condition type"
              value={condition.kind}
              onChange={(value) =>
                updateCondition(index, makeCondition(value as RuleCondition["kind"]))
              }
              options={ruleConditionOptions(board.tags.length > 0)}
            />
            {condition.kind === "column" && (
              <>
                <SelectPill
                  ariaLabel="Column condition operator"
                  value={condition.operator}
                  onChange={(value) =>
                    updateCondition(index, {
                      ...condition,
                      operator: value as "in" | "not_in",
                    })
                  }
                  options={[
                    ["in", "is in"],
                    ["not_in", "is not in"],
                  ]}
                />
                <select
                  multiple
                  aria-label="Condition columns"
                  value={condition.columnIds}
                  onChange={(event) =>
                    updateCondition(index, {
                      ...condition,
                      columnIds: [...event.currentTarget.selectedOptions].map(
                        (option) => option.value,
                      ),
                    })
                  }
                  className="min-h-8 text-xs bg-surface border border-border rounded-md px-2 py-1 text-foreground/90 outline-none focus:border-primary/60"
                >
                  {board.columns.map((column) => (
                    <option key={column.id} value={column.id} className="bg-popover">
                      {column.name}
                    </option>
                  ))}
                </select>
              </>
            )}
            {condition.kind === "tag" && (
              <SelectPill
                value={condition.tagId}
                onChange={(tagId) => updateCondition(index, { kind: "tag", tagId })}
                options={board.tags.map<[string, string]>((tag) => [tag.id, tag.name])}
              />
            )}
            {condition.kind === "completed" && (
              <SelectPill
                value={condition.value ? "1" : "0"}
                onChange={(value) =>
                  updateCondition(index, { kind: "completed", value: value === "1" })
                }
                options={[
                  ["0", "is open"],
                  ["1", "is complete"],
                ]}
              />
            )}
            {condition.kind === "dueState" && (
              <SelectPill
                value={condition.value}
                onChange={(value) =>
                  updateCondition(index, {
                    kind: "dueState",
                    value: value as DueState,
                  })
                }
                options={ruleDueStateOptions()}
              />
            )}
            {(condition.kind === "createdAgeDays" || condition.kind === "completedAgeDays") && (
              <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                at least
                <input
                  type="number"
                  min={0}
                  step={1}
                  aria-label="Age in days"
                  value={condition.value}
                  onChange={(event) =>
                    updateCondition(index, {
                      kind: condition.kind,
                      value: Math.max(0, Number(event.target.value) || 0),
                    })
                  }
                  className="h-8 w-20 rounded-md border border-border bg-surface px-2 text-xs text-foreground outline-none focus:border-primary/60"
                />
                days
              </label>
            )}
            <button
              type="button"
              onClick={() => setConditions(conditions.filter((_, current) => current !== index))}
              aria-label="Remove condition"
              className="text-muted-foreground hover:text-danger p-1 rounded-md hover:bg-accent"
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <select
          value=""
          aria-label="Add condition"
          onChange={(event) => {
            if (event.target.value)
              setConditions([
                ...conditions,
                makeCondition(event.target.value as RuleCondition["kind"]),
              ]);
            event.target.value = "";
          }}
          className="text-[11px] bg-surface-sunken border border-dashed border-border rounded-md px-2 py-1 text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <option value="">+ Add condition…</option>
          {ruleConditionOptions(board.tags.length > 0).map(([kind, label]) => (
            <option key={kind} value={kind}>
              {label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function ActionsEditor({ rule, board }: { rule: Rule; board: ReturnType<typeof useBoard> }) {
  const setActions = (actions: RuleAction[]) => rulesStore.update(rule.id, { actions });

  const addAction = (kind: RuleAction["kind"]) => {
    let a: RuleAction;
    switch (kind) {
      case "setDueDate":
        a = { kind: "setDueDate", offsetDays: 0 };
        break;
      case "clearDueDate":
        a = { kind: "clearDueDate" };
        break;
      case "addTag":
        a = { kind: "addTag", tagId: board.tags[0]?.id ?? "" };
        break;
      case "removeTag":
        a = { kind: "removeTag", tagId: board.tags[0]?.id ?? "" };
        break;
      case "moveToColumn":
        a = { kind: "moveToColumn", columnId: board.columns[0]?.id ?? "" };
        break;
      case "setCompleted":
        a = { kind: "setCompleted", value: true };
        break;
      case "sortByDueDate":
        a = { kind: "sortByDueDate" };
        break;
      case "archiveCard":
        a = { kind: "archiveCard" };
        break;
    }
    setActions([...rule.actions, a]);
  };

  const updateAction = (idx: number, action: RuleAction) => {
    setActions(rule.actions.map((a, i) => (i === idx ? action : a)));
  };
  const removeAction = (idx: number) => {
    setActions(rule.actions.filter((_, i) => i !== idx));
  };

  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-subtle-foreground mb-1.5">Then</div>
      <div className="space-y-1.5">
        {rule.actions.map((a, i) => (
          <div key={i} className="flex flex-wrap items-center gap-1.5">
            <SelectPill
              value={a.kind}
              onChange={(v) => {
                const kind = v as RuleAction["kind"];
                if (kind === a.kind) return;
                let next: RuleAction;
                switch (kind) {
                  case "setDueDate":
                    next = { kind: "setDueDate", offsetDays: 0 };
                    break;
                  case "clearDueDate":
                    next = { kind: "clearDueDate" };
                    break;
                  case "addTag":
                    next = { kind: "addTag", tagId: board.tags[0]?.id ?? "" };
                    break;
                  case "removeTag":
                    next = { kind: "removeTag", tagId: board.tags[0]?.id ?? "" };
                    break;
                  case "moveToColumn":
                    next = {
                      kind: "moveToColumn",
                      columnId: board.columns[0]?.id ?? "",
                    };
                    break;
                  case "setCompleted":
                    next = { kind: "setCompleted", value: true };
                    break;
                  case "sortByDueDate":
                    next = { kind: "sortByDueDate" };
                    break;
                  case "archiveCard":
                    next = { kind: "archiveCard" };
                    break;
                }
                updateAction(i, next);
              }}
              options={ruleActionOptions(board.tags.length > 0)}
            />
            {a.kind === "setDueDate" && (
              <SelectPill
                value={String(a.offsetDays)}
                onChange={(v) => updateAction(i, { kind: "setDueDate", offsetDays: Number(v) })}
                options={[
                  ["0", "today"],
                  ["1", "tomorrow"],
                  ["2", "in 2 days"],
                  ["3", "in 3 days"],
                  ["7", "in 1 week"],
                  ["14", "in 2 weeks"],
                  ["30", "in 30 days"],
                ]}
              />
            )}
            {(a.kind === "addTag" || a.kind === "removeTag") && (
              <SelectPill
                value={a.tagId}
                onChange={(v) =>
                  updateAction(
                    i,
                    a.kind === "addTag"
                      ? { kind: "addTag", tagId: v }
                      : { kind: "removeTag", tagId: v },
                  )
                }
                options={board.tags.map<[string, string]>((t) => [t.id, t.name])}
              />
            )}
            {a.kind === "moveToColumn" && (
              <SelectPill
                value={a.columnId}
                onChange={(v) => updateAction(i, { kind: "moveToColumn", columnId: v })}
                options={board.columns.map<[string, string]>((c) => [c.id, c.name])}
              />
            )}
            {a.kind === "setCompleted" && (
              <SelectPill
                value={a.value ? "1" : "0"}
                onChange={(v) => updateAction(i, { kind: "setCompleted", value: v === "1" })}
                options={[
                  ["1", "complete"],
                  ["0", "open"],
                ]}
              />
            )}
            {a.kind === "sortByDueDate" && (
              <span className="text-[11px] text-muted-foreground">
                Sort every column by due date · undated last
              </span>
            )}
            {a.kind === "archiveCard" && (
              <span className="text-[11px] text-muted-foreground">
                Preserve the card in the workspace archive
              </span>
            )}
            <button
              onClick={() => removeAction(i)}
              disabled={rule.actions.length === 1}
              title={
                rule.actions.length === 1
                  ? "Stored rules must keep at least one action"
                  : "Remove action"
              }
              className="text-muted-foreground hover:text-danger p-1 rounded-md hover:bg-accent disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:text-muted-foreground disabled:hover:bg-transparent"
            >
              <X size={12} />
            </button>
          </div>
        ))}
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) {
              addAction(e.target.value as RuleAction["kind"]);
              e.target.value = "";
            }
          }}
          className="text-[11px] bg-surface-sunken border border-dashed border-border rounded-md px-2 py-1 text-muted-foreground hover:text-foreground cursor-pointer"
        >
          <option value="">+ Add action…</option>
          {ruleActionOptions(board.tags.length > 0).map(([kind, label]) => (
            <option key={kind} value={kind}>
              {label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function SelectPill({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  ariaLabel?: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-xs bg-surface border border-border rounded-md px-2 py-1 text-foreground/90 outline-none focus:border-primary/60 cursor-pointer"
    >
      {options.map(([v, l]) => (
        <option key={v} value={v} className="bg-popover">
          {l}
        </option>
      ))}
    </select>
  );
}
