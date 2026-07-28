import { join } from "node:path";
import { stringify } from "yaml";

import type { Board, Card, ChecklistItem, Comment, Column, Tag } from "../types";
import { FileMutation, rollbackAndRethrow } from "./file-transaction";
import {
  validateWorkspace,
  type CardResource,
  type Diagnostic,
  type WorkspaceSnapshot,
} from "./validator";

export class WorkspaceValidationError extends Error {
  constructor(readonly diagnostics: Diagnostic[]) {
    super(
      `Workspace validation failed with ${diagnostics.length} error(s): ${diagnostics
        .map((diagnostic) => `${diagnostic.code} at ${diagnostic.filePath}:${diagnostic.fieldPath}`)
        .join(", ")}`,
    );
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sourceFields(value: Record<string, unknown> | undefined) {
  if (!value) return {};
  const { __filePath: _internalPath, ...source } = value;
  return source;
}

function columnSourceFields(value: Record<string, unknown> | undefined) {
  const { defaults: _defaults, behavior: _behavior, ...source } = sourceFields(value);
  return source;
}

function columnOrder(snapshot: WorkspaceSnapshot) {
  const ui = asRecord(snapshot.workspace.ui);
  const explicit = Array.isArray(ui.column_order) ? (ui.column_order as string[]) : [];
  return explicit.length > 0
    ? explicit
    : [...snapshot.columns.values()]
        .sort((left, right) => Number(left.position) - Number(right.position))
        .map((column) => String(column.id));
}

function projectCard(snapshot: WorkspaceSnapshot, resource: CardResource): Card {
  const checklists: ChecklistItem[] = resource.checklistIds.flatMap((checklistId) => {
    const checklist = snapshot.checklists.get(checklistId);
    if (!checklist) return [];
    return [...checklist.items]
      .sort((left, right) => Number(left.position) - Number(right.position))
      .map((item) => ({
        id: String(item.id),
        text: String(item.text),
        done: item.completed === true,
      }));
  });
  const comments: Comment[] = resource.commentIds.flatMap((commentId) => {
    const comment = snapshot.comments.get(commentId);
    if (!comment) return [];
    return [{ id: comment.id, body: comment.body, createdAt: comment.createdAt ?? "" }];
  });
  return {
    id: resource.id,
    title: resource.title,
    description: resource.body,
    dueDate: resource.dueAt?.slice(0, 10) ?? null,
    checklist: checklists,
    comments,
    tagIds: resource.tagIds,
    completed: resource.completed,
    completedAt: resource.completedAt,
    createdAt: resource.createdAt,
    updatedAt: resource.updatedAt,
  };
}

function projectWorkspaceBoard(snapshot: WorkspaceSnapshot): Board {
  const columns: Column[] = columnOrder(snapshot).flatMap((id) => {
    const source = snapshot.columns.get(id);
    if (!source) return [];
    const cards = [...snapshot.cards.values()]
      .filter((card) => !card.archived && card.columnId === id)
      .sort((left, right) => left.position - right.position);
    return [{ id, name: String(source.name), cardIds: cards.map((card) => card.id) }];
  });
  const tags: Tag[] = [...snapshot.tags.values()].map((tag) => ({
    id: String(tag.id),
    name: String(tag.name),
    color: String(tag.color) as Tag["color"],
  }));
  const cards: Record<string, Card> = {};
  for (const resource of snapshot.cards.values()) {
    if (resource.archived) continue;
    cards[resource.id] = projectCard(snapshot, resource);
  }
  return { columns, cards, tags };
}

export async function readWorkspaceBoard(root: string): Promise<Board> {
  const result = await validateWorkspace(root);
  if (result.errors.length > 0 || !result.workspace) {
    throw new WorkspaceValidationError(result.errors);
  }
  return projectWorkspaceBoard(result.workspace);
}

function yamlCard(card: Card, columnId: string, checklistIds: string[], commentIds: string[]) {
  return {
    schema_version: 1,
    id: card.id,
    title: card.title,
    column_id: columnId,
    position: 0,
    completed: card.completed,
    completed_at: card.completedAt,
    due_at: card.dueDate ? `${card.dueDate}T00:00:00Z` : null,
    tag_ids: card.tagIds,
    checklist_ids: checklistIds,
    comment_ids: commentIds,
    created_at: card.createdAt,
    updated_at: card.updatedAt,
    archived_at: null,
  };
}

function requireResourceId(kind: string, id: string) {
  if (!new RegExp(`^${kind}_[a-z0-9]+(?:_[a-z0-9]+)*$`).test(id)) {
    throw new Error(`Cannot save ${kind}: ${id} is not a lowercase immutable ${kind}_ ID.`);
  }
}

export async function writeWorkspaceBoard(root: string, board: Board): Promise<void> {
  const result = await validateWorkspace(root);
  if (result.errors.length > 0 || !result.workspace) {
    throw new WorkspaceValidationError(result.errors);
  }
  const snapshot = result.workspace;
  const originalBoard = projectWorkspaceBoard(snapshot);
  if (JSON.stringify(originalBoard) === JSON.stringify(board)) return;
  const paths = asRecord(snapshot.workspace.paths);
  const cardsDir = String(paths.cards);
  const columnsDir = String(paths.columns);
  const tagsDir = String(paths.tags);
  const commentsDir = String(paths.comments);
  const checklistsDir = String(paths.checklists);
  const archiveDir = String(paths.archive);
  const removedColumnIds = [...snapshot.columns.keys()].filter(
    (id) => !board.columns.some((column) => column.id === id),
  );
  const removedTagIds = [...snapshot.tags.keys()].filter(
    (id) => !board.tags.some((tag) => tag.id === id),
  );
  const protectedSource = JSON.stringify({
    defaults: snapshot.workspace.defaults,
    rules: [...snapshot.rules.values()],
    templates: [...snapshot.templates.values()],
  });
  for (const id of [...removedColumnIds, ...removedTagIds]) {
    if (protectedSource.includes(`"${id}"`)) {
      throw new Error(
        `Cannot remove ${id}: it is still referenced by workspace defaults, rules, or templates. Remove those references first.`,
      );
    }
  }
  const transaction = new FileMutation();
  try {
    const columnByCard = new Map<string, { id: string; position: number }>();
    for (const [columnPosition, column] of board.columns.entries()) {
      requireResourceId("column", column.id);
      for (const [cardPosition, cardId] of column.cardIds.entries()) {
        if (!board.cards[cardId])
          throw new Error(`Column ${column.id} references missing card ${cardId}.`);
        columnByCard.set(cardId, { id: column.id, position: (cardPosition + 1) * 1024 });
      }
      const original = snapshot.columns.get(column.id);
      if (original && String(original.name) === column.name) continue;
      await transaction.write(
        join(root, columnsDir, `${column.id}.yaml`),
        stringify({
          ...columnSourceFields(original),
          schema_version: 1,
          id: column.id,
          name: column.name,
          position: (columnPosition + 1) * 1024,
          color: original?.color ?? null,
          created_at: original?.created_at ?? new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      );
    }
    for (const id of snapshot.columns.keys()) {
      if (!board.columns.some((candidate) => candidate.id === id)) {
        await transaction.remove(join(root, columnsDir, `${id}.yaml`));
      }
    }
    for (const tag of board.tags) {
      requireResourceId("tag", tag.id);
      const original = snapshot.tags.get(tag.id);
      if (original && String(original.name) === tag.name && String(original.color) === tag.color)
        continue;
      await transaction.write(
        join(root, tagsDir, `${tag.id}.yaml`),
        stringify({
          ...sourceFields(original),
          schema_version: 1,
          id: tag.id,
          name: tag.name,
          color: tag.color,
          description: original?.description ?? null,
          created_at: original?.created_at ?? new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      );
    }
    for (const id of snapshot.tags.keys()) {
      if (!board.tags.some((tag) => tag.id === id))
        await transaction.remove(join(root, tagsDir, `${id}.yaml`));
    }
    for (const card of Object.values(board.cards)) {
      requireResourceId("card", card.id);
      const location = columnByCard.get(card.id);
      if (!location) throw new Error(`Card ${card.id} is not assigned to an active column.`);
      const original = snapshot.cards.get(card.id);
      const originalCard = original ? projectCard(snapshot, original) : undefined;
      const checklistChanged =
        !originalCard || JSON.stringify(originalCard.checklist) !== JSON.stringify(card.checklist);
      const commentsChanged =
        !originalCard || JSON.stringify(originalCard.comments) !== JSON.stringify(card.comments);
      const cardChanged =
        !original ||
        JSON.stringify(originalCard) !== JSON.stringify(card) ||
        original.columnId !== location.id ||
        original.position !== location.position;
      if (!cardChanged) continue;
      const primaryChecklistId =
        original?.checklistIds[0] ??
        (card.checklist.length > 0 ? `checklist_${card.id.slice(5)}` : undefined);
      const checklistIds = primaryChecklistId
        ? [primaryChecklistId, ...(original?.checklistIds.slice(1) ?? [])]
        : [];
      if (primaryChecklistId && checklistChanged) {
        await transaction.write(
          join(root, checklistsDir, `${primaryChecklistId}.yaml`),
          stringify({
            schema_version: 1,
            id: primaryChecklistId,
            card_id: card.id,
            title: "Checklist",
            position: 1024,
            created_at: original?.createdAt ?? card.createdAt,
            updated_at: new Date().toISOString(),
            items: card.checklist.map((item, index) => ({
              id: item.id,
              text: item.text,
              completed: item.done,
              position: (index + 1) * 1024,
            })),
          }),
        );
      }
      const commentIds = card.comments.map((comment) => comment.id);
      if (commentsChanged) {
        for (const comment of card.comments) {
          requireResourceId("comment", comment.id);
          await transaction.write(
            join(root, commentsDir, `${comment.id}.md`),
            `---\n${stringify({
              schema_version: 1,
              id: comment.id,
              card_id: card.id,
              author: "local-user",
              created_at: comment.createdAt,
              updated_at: new Date().toISOString(),
            })}---\n\n${comment.body.trim()}\n`,
          );
        }
        for (const commentId of original?.commentIds ?? []) {
          if (!commentIds.includes(commentId))
            await transaction.remove(join(root, commentsDir, `${commentId}.md`));
        }
      }
      const cardData = yamlCard(card, location.id, checklistIds, commentIds);
      cardData.position = location.position;
      await transaction.write(
        join(root, cardsDir, `${card.id}.md`),
        `---\n${stringify(cardData)}---\n${card.description}`.replace(/\n*$/, "\n"),
      );
    }
    for (const [id, card] of snapshot.cards) {
      if (!card.archived && !board.cards[id]) {
        const archivedAt = new Date().toISOString();
        await transaction.write(
          join(root, archiveDir, "cards", `${id}.md`),
          `---\n${stringify({
            schema_version: 1,
            id: card.id,
            title: card.title,
            column_id: null,
            previous_column_id: card.columnId,
            position: card.position,
            completed: card.completed,
            completed_at: card.completedAt,
            due_at: card.dueAt,
            tag_ids: card.tagIds,
            checklist_ids: card.checklistIds,
            comment_ids: card.commentIds,
            created_at: card.createdAt,
            updated_at: card.updatedAt,
            archived_at: archivedAt,
          })}---\n${card.body}`.replace(/\n*$/, "\n"),
        );
        await transaction.remove(join(root, cardsDir, `${id}.md`));
        for (const checklistId of card.checklistIds)
          await transaction.move(
            join(root, checklistsDir, `${checklistId}.yaml`),
            join(root, archiveDir, "checklists", `${checklistId}.yaml`),
          );
        for (const commentId of card.commentIds)
          await transaction.move(
            join(root, commentsDir, `${commentId}.md`),
            join(root, archiveDir, "comments", `${commentId}.md`),
          );
      }
    }
    const nextColumnOrder = board.columns.map((column) => column.id);
    if (JSON.stringify(columnOrder(snapshot)) !== JSON.stringify(nextColumnOrder)) {
      const workspaceData = {
        ...snapshot.workspace,
        ui: {
          ...asRecord(snapshot.workspace.ui),
          column_order: nextColumnOrder,
        },
      };
      await transaction.write(join(root, "flowmark.yaml"), stringify(workspaceData));
    }
    const finalResult = await validateWorkspace(root);
    if (finalResult.errors.length > 0) throw new WorkspaceValidationError(finalResult.errors);
    transaction.commit();
  } catch (error) {
    await rollbackAndRethrow(transaction, error);
  }
}
