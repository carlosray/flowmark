import { createServerFn } from "@tanstack/react-start";

import { pendingOccurrences, type PendingSeries } from "./workspace/schedule-state";
import { resolveOccurrenceDecision, type OccurrenceDecision } from "./workspace/scheduled-cards";

function workspaceRoot() {
  return process.env.FLOWMARK_WORKSPACE_ROOT ?? process.cwd();
}

const DECISIONS = ["repeat", "skip", "repeat_series", "decline_series"] as const;

export const getPendingOccurrences = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ series: PendingSeries[] }> => ({
    series: await pendingOccurrences(workspaceRoot()),
  }),
);

export const resolvePendingOccurrence = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const value = data as { ruleId?: unknown; decision?: unknown; occurrence?: unknown };
    if (typeof value?.ruleId !== "string") throw new Error("ruleId must be a string.");
    if (typeof value.occurrence !== "string" || Number.isNaN(Date.parse(value.occurrence)))
      throw new Error("occurrence must be an ISO 8601 timestamp.");
    if (!(DECISIONS as readonly unknown[]).includes(value.decision))
      throw new Error(`decision must be one of ${DECISIONS.join(", ")}.`);
    return {
      ruleId: value.ruleId,
      occurrence: value.occurrence,
      decision: value.decision as OccurrenceDecision,
    };
  })
  .handler(async ({ data }): Promise<{ created: string[] }> => {
    const created = await resolveOccurrenceDecision(workspaceRoot(), data.ruleId, {
      occurrence: new Date(data.occurrence),
      decision: data.decision,
    });
    return { created };
  });
