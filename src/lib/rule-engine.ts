import { calendarDateAtOffset } from "./calendar-date";
import type { DueState, Rule, RuleAction, RuleCondition, RuleTrigger } from "./rule-model";
import type { Board, Card } from "./types";

export type RuleEvent =
  | { kind: "card.created"; cardId: string; columnId: string }
  | { kind: "card.moved"; cardId: string; fromColumnId: string; toColumnId: string }
  | { kind: "card.completed"; cardId: string; completed: boolean }
  | { kind: "card.dueStateChanged"; cardId: string };

export interface RuleEngineDiagnostic {
  code: "E_RULE_CYCLE" | "E_RULE_TRANSACTION_LIMIT";
  message: string;
  ruleId?: string;
  cardId?: string;
}

export interface RuleTransactionInput {
  board: Board;
  rules: Rule[];
  events: RuleEvent[];
  now: Date;
  timeZone: string;
  maxOperations?: number;
}

export interface RuleTransactionResult {
  board: Board;
  changed: boolean;
  operations: number;
  diagnostics: RuleEngineDiagnostic[];
}

function cardColumnId(board: Board, cardId: string) {
  return board.columns.find((column) => column.cardIds.includes(cardId))?.id ?? null;
}

function ageDays(value: string | null, now: Date) {
  if (!value) return null;
  return Math.floor((now.getTime() - new Date(value).getTime()) / 86_400_000);
}

export function dueState(card: Card, now: Date, timeZone: string): DueState {
  if (!card.dueDate) return "none";
  const today = calendarDateAtOffset(now, 0, timeZone);
  const tomorrow = calendarDateAtOffset(now, 1, timeZone);
  if (card.dueDate < today) return "overdue";
  if (card.dueDate === today) return "today";
  if (card.dueDate === tomorrow) return "tomorrow";
  return "future";
}

function matchesTrigger(
  trigger: RuleTrigger,
  event: RuleEvent,
  card: Card,
  now: Date,
  timeZone: string,
) {
  switch (trigger.kind) {
    case "card.created":
      return (
        event.kind === "card.created" &&
        (trigger.columnId === "*" || trigger.columnId === event.columnId)
      );
    case "card.moved":
      return event.kind === "card.moved" && trigger.toColumnId === event.toColumnId;
    case "card.completed":
      return event.kind === "card.completed" && trigger.value === event.completed;
    case "card.dueOn":
      return (
        event.kind === "card.dueStateChanged" &&
        !card.completed &&
        dueState(card, now, timeZone) === trigger.when
      );
    case "card.dueStateChanged":
      return event.kind === "card.dueStateChanged";
  }
}

function matchesCondition(
  condition: RuleCondition,
  board: Board,
  card: Card,
  now: Date,
  timeZone: string,
) {
  switch (condition.kind) {
    case "column": {
      const included = condition.columnIds.includes(cardColumnId(board, card.id) ?? "");
      return condition.operator === "in" ? included : !included;
    }
    case "tag":
      return card.tagIds.includes(condition.tagId);
    case "completed":
      return card.completed === condition.value;
    case "dueState":
      return dueState(card, now, timeZone) === condition.value;
    case "createdAgeDays": {
      const age = ageDays(card.createdAt, now);
      return age !== null && age >= condition.value;
    }
    case "completedAgeDays": {
      const age = ageDays(card.completedAt, now);
      return age !== null && age >= condition.value;
    }
  }
}

function eventKey(event: RuleEvent) {
  switch (event.kind) {
    case "card.created":
      return `${event.kind}:${event.cardId}:${event.columnId}`;
    case "card.moved":
      return `${event.kind}:${event.cardId}:${event.fromColumnId}:${event.toColumnId}`;
    case "card.completed":
      return `${event.kind}:${event.cardId}:${event.completed}`;
    case "card.dueStateChanged":
      return `${event.kind}:${event.cardId}`;
  }
}

function cardStateKey(board: Board, card: Card) {
  return [
    cardColumnId(board, card.id),
    card.dueDate,
    card.completed,
    [...card.tagIds].sort().join(","),
  ].join("|");
}

function replaceCard(board: Board, card: Card): Board {
  return { ...board, cards: { ...board.cards, [card.id]: card } };
}

function moveCard(board: Board, cardId: string, columnId: string): Board {
  if (!board.columns.some((column) => column.id === columnId)) return board;
  const fromColumnId = cardColumnId(board, cardId);
  if (!fromColumnId || fromColumnId === columnId) return board;
  return {
    ...board,
    columns: board.columns.map((column) => {
      const without = column.cardIds.filter((id) => id !== cardId);
      return column.id === columnId
        ? { ...column, cardIds: [cardId, ...without] }
        : { ...column, cardIds: without };
    }),
  };
}

function stableDueSort(board: Board, previousOrder: ReadonlyMap<string, number>): Board {
  let changed = false;
  const columns = board.columns.map((column) => {
    const sorted = column.cardIds
      .map((cardId, index) => ({ cardId, index, dueDate: board.cards[cardId]?.dueDate ?? null }))
      .sort((left, right) => {
        if (left.dueDate === right.dueDate)
          return (
            (previousOrder.get(left.cardId) ?? left.index) -
            (previousOrder.get(right.cardId) ?? right.index)
          );
        if (left.dueDate === null) return 1;
        if (right.dueDate === null) return -1;
        return left.dueDate.localeCompare(right.dueDate);
      })
      .map(({ cardId }) => cardId);
    const columnChanged = sorted.some((cardId, index) => cardId !== column.cardIds[index]);
    if (columnChanged) changed = true;
    return columnChanged ? { ...column, cardIds: sorted } : column;
  });
  return changed ? { ...board, columns } : board;
}

export function applyRuleTransaction(input: RuleTransactionInput): RuleTransactionResult {
  // Root reconciliation events scale with workspace size; the default budget must
  // bound cascade depth without making a large, valid board fail to start.
  const maxOperations = input.maxOperations ?? Math.max(1_000, input.events.length * 32);
  const rules = input.rules.filter((rule) => rule.enabled).sort((a, b) => a.id.localeCompare(b.id));
  const queue = [...input.events];
  const previousOrder = new Map(
    input.board.columns.flatMap((column) => column.cardIds).map((cardId, index) => [cardId, index]),
  );
  const seen = new Set<string>();
  const diagnostics: RuleEngineDiagnostic[] = [];
  let board = input.board;
  let operations = 0;
  let sortRequested = false;

  const enqueueDueState = (cardId: string) => {
    queue.push({ kind: "card.dueStateChanged", cardId });
  };

  const applyAction = (cardId: string, action: RuleAction) => {
    const card = board.cards[cardId];
    if (!card) return;
    const updatedAt = input.now.toISOString();
    switch (action.kind) {
      case "setDueDate": {
        const dueDate = calendarDateAtOffset(input.now, action.offsetDays, input.timeZone);
        if (card.dueDate === dueDate) return;
        board = replaceCard(board, { ...card, dueDate, updatedAt });
        operations += 1;
        enqueueDueState(cardId);
        return;
      }
      case "clearDueDate":
        if (card.dueDate === null) return;
        board = replaceCard(board, { ...card, dueDate: null, updatedAt });
        operations += 1;
        enqueueDueState(cardId);
        return;
      case "addTag":
        if (card.tagIds.includes(action.tagId)) return;
        board = replaceCard(board, { ...card, tagIds: [...card.tagIds, action.tagId], updatedAt });
        operations += 1;
        return;
      case "removeTag":
        if (!card.tagIds.includes(action.tagId)) return;
        board = replaceCard(board, {
          ...card,
          tagIds: card.tagIds.filter((tagId) => tagId !== action.tagId),
          updatedAt,
        });
        operations += 1;
        return;
      case "moveToColumn": {
        const fromColumnId = cardColumnId(board, cardId);
        const next = moveCard(board, cardId, action.columnId);
        if (next === board || !fromColumnId) return;
        board = next;
        operations += 1;
        queue.push({
          kind: "card.moved",
          cardId,
          fromColumnId,
          toColumnId: action.columnId,
        });
        enqueueDueState(cardId);
        return;
      }
      case "setCompleted":
        if (card.completed === action.value) return;
        board = replaceCard(board, {
          ...card,
          completed: action.value,
          completedAt: action.value ? updatedAt : null,
          updatedAt,
        });
        operations += 1;
        queue.push({ kind: "card.completed", cardId, completed: action.value });
        enqueueDueState(cardId);
        return;
      case "sortByDueDate":
        sortRequested = true;
        return;
      case "archiveCard":
        board = {
          ...board,
          cards: Object.fromEntries(
            Object.entries(board.cards).filter(([candidateId]) => candidateId !== cardId),
          ),
          columns: board.columns.map((column) => ({
            ...column,
            cardIds: column.cardIds.filter((candidateId) => candidateId !== cardId),
          })),
        };
        operations += 1;
        return;
    }
  };

  let processedEvents = 0;
  while (queue.length > 0) {
    if (processedEvents >= maxOperations || operations >= maxOperations) {
      diagnostics.push({
        code: "E_RULE_TRANSACTION_LIMIT",
        message: `Rule transaction exceeded the ${maxOperations} operation limit.`,
      });
      break;
    }
    const event = queue.shift()!;
    processedEvents += 1;
    const card = board.cards[event.cardId];
    if (!card) continue;

    for (const candidate of rules) {
      const current = board.cards[event.cardId];
      if (!current || !matchesTrigger(candidate.trigger, event, current, input.now, input.timeZone))
        continue;
      if (
        !(candidate.conditions ?? []).every((condition) =>
          matchesCondition(condition, board, current, input.now, input.timeZone),
        )
      )
        continue;
      const fingerprint = `${eventKey(event)}:${candidate.id}:${cardStateKey(board, current)}`;
      if (seen.has(fingerprint)) {
        if (event.kind !== "card.dueStateChanged")
          diagnostics.push({
            code: "E_RULE_CYCLE",
            message: `Rule cycle detected while evaluating ${candidate.id} for ${event.cardId}.`,
            ruleId: candidate.id,
            cardId: event.cardId,
          });
        continue;
      }
      seen.add(fingerprint);
      for (const action of candidate.actions) applyAction(event.cardId, action);
    }

    if (event.kind !== "card.dueStateChanged") enqueueDueState(event.cardId);
  }

  if (sortRequested) {
    const sorted = stableDueSort(board, previousOrder);
    if (sorted !== board) {
      board = sorted;
      operations += 1;
    }
  }

  return {
    board,
    changed: board !== input.board,
    operations,
    diagnostics,
  };
}
