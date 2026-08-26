import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { stringify } from "yaml";

import { validateTemplateText } from "../template-expression";
import { FileMutation, rollbackAndRethrow } from "./file-transaction";
import { validateWorkspace } from "./validator";

type SourceValue = Record<string, unknown>;

export type TemplateDue =
  | { mode: "none" }
  | { mode: "offset"; offsetDays: number }
  | { mode: "fixed"; date: string };

export interface CardTemplate {
  id: string;
  name: string;
  title: string;
  body: string;
  columnId: string | null;
  tagIds: string[];
  due: TemplateDue;
  checklist: string[];
}

export interface TemplatesWriteRequest {
  templates: CardTemplate[];
  deletedIds: string[];
}

export const TEMPLATE_ID_PATTERN = /^template_[a-z0-9]+(?:_[a-z0-9]+)*$/;

export function createTemplateId() {
  const suffix = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  return `template_${suffix}`;
}

function asRecord(value: unknown): SourceValue {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as SourceValue)
    : {};
}

/** Drops the internal keys the validator attaches to parsed resources. */
function sourceFields(value: SourceValue | undefined) {
  if (!value) return {};
  const { __filePath: _path, __body: _body, ...source } = value;
  return source;
}

function dueFromSource(value: unknown): TemplateDue {
  const due = asRecord(value);
  if (due.mode === "offset")
    return {
      mode: "offset",
      offsetDays: typeof due.offset_days === "number" ? due.offset_days : 0,
    };
  if (due.mode === "fixed") return { mode: "fixed", date: String(due.date) };
  return { mode: "none" };
}

function dueToSource(due: TemplateDue): SourceValue {
  if (due.mode === "offset") return { mode: "offset", offset_days: due.offsetDays };
  if (due.mode === "fixed") return { mode: "fixed", date: due.date };
  return { mode: "none" };
}

/** Projects a validated template resource into the editor/runtime shape. */
export function toCardTemplate(source: SourceValue): CardTemplate {
  const card = asRecord(source.card);
  return {
    id: String(source.id),
    name: String(source.name),
    title: typeof card.title === "string" ? card.title : "",
    body: typeof source.__body === "string" ? source.__body : "",
    columnId: typeof card.column_id === "string" ? card.column_id : null,
    tagIds: Array.isArray(card.tag_ids) ? card.tag_ids.map(String) : [],
    due: dueFromSource(card.due),
    checklist: Array.isArray(source.checklist) ? source.checklist.map(String) : [],
  };
}

function validationMessage(result: Awaited<ReturnType<typeof validateWorkspace>>) {
  return result.errors.map((error) => `${error.code}: ${error.message}`).join("\n");
}

/**
 * Rejects what the editor should never have offered, so a bad template fails
 * before touching disk rather than through a rollback.
 */
function validateTemplate(template: CardTemplate, columns: Set<string>, tags: Set<string>) {
  if (!TEMPLATE_ID_PATTERN.test(template.id))
    throw new Error(`Invalid template ID: ${template.id}`);
  if (!template.name.trim()) throw new Error(`Template ${template.id} must have a name.`);
  if (!template.title.trim()) throw new Error(`Template ${template.id} must have a card title.`);
  for (const [field, text] of [
    ["title", template.title],
    ["body", template.body],
    ...template.checklist.map((item, index) => [`checklist[${index}]`, item] as const),
  ] as const) {
    const [issue] = validateTemplateText(text);
    if (issue)
      throw new Error(
        `Template ${template.id} ${field} uses ${issue.expression}, which is not a usable expression. ${issue.message}`,
      );
  }
  if (template.columnId !== null && !columns.has(template.columnId))
    throw new Error(`Template ${template.id} references missing column ${template.columnId}.`);
  for (const tagId of template.tagIds)
    if (!tags.has(tagId))
      throw new Error(`Template ${template.id} references missing tag ${tagId}.`);
  if (template.due.mode === "offset" && !Number.isInteger(template.due.offsetDays))
    throw new Error(`Template ${template.id} needs a whole number of offset days.`);
  if (template.due.mode === "fixed" && !/^\d{4}-\d{2}-\d{2}$/.test(template.due.date))
    throw new Error(`Template ${template.id} needs a calendar date for its fixed due date.`);
}

function rulesReferencing(rules: Iterable<SourceValue>, templateId: string): string[] {
  const referencing: string[] = [];
  for (const rule of rules) {
    const actions = Array.isArray(rule.actions) ? rule.actions.map(asRecord) : [];
    if (actions.some((action) => action.template_id === templateId))
      referencing.push(String(rule.id));
  }
  return referencing;
}

export async function readWorkspaceTemplates(root: string): Promise<{
  path: string;
  templates: CardTemplate[];
  locale: string;
  timeZone: string;
}> {
  const result = await validateWorkspace(root);
  if (result.errors.length > 0 || !result.workspace)
    throw new Error(validationMessage(result) || "Workspace validation failed.");
  const paths = asRecord(result.workspace.workspace.paths);
  const workspace = asRecord(result.workspace.workspace.workspace);
  const ui = asRecord(result.workspace.workspace.ui);
  return {
    path: join(root, String(paths.templates)),
    templates: [...result.workspace.templates.values()]
      .map((source) => toCardTemplate(source))
      .sort(
        (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
      ),
    locale: typeof ui.locale === "string" ? ui.locale : "en",
    timeZone: typeof workspace.timezone === "string" ? workspace.timezone : "UTC",
  };
}

export async function writeWorkspaceTemplates(
  root: string,
  request: TemplatesWriteRequest,
  now = new Date(),
): Promise<{ path: string }> {
  const before = await validateWorkspace(root);
  if (before.errors.length > 0 || !before.workspace)
    throw new Error(validationMessage(before) || "Workspace validation failed.");

  const columns = new Set(before.workspace.columns.keys());
  const tags = new Set(before.workspace.tags.keys());
  const ids = new Set<string>();
  for (const template of request.templates) {
    validateTemplate(template, columns, tags);
    if (ids.has(template.id)) throw new Error(`Duplicate template ID: ${template.id}`);
    ids.add(template.id);
  }
  for (const id of request.deletedIds) {
    if (!TEMPLATE_ID_PATTERN.test(id)) throw new Error(`Invalid template ID: ${id}`);
    if (ids.has(id)) throw new Error(`Template ${id} cannot be saved and deleted together.`);
    const referencing = rulesReferencing(before.workspace.rules.values(), id);
    if (referencing.length > 0)
      throw new Error(
        `Cannot delete ${id}: it is still used by ${referencing.join(", ")}. Change those rules first.`,
      );
  }

  const paths = asRecord(before.workspace.workspace.paths);
  const templatesDir = join(root, String(paths.templates));
  await mkdir(templatesDir, { recursive: true });
  const transaction = new FileMutation();
  try {
    for (const template of request.templates) {
      const existing = before.workspace.templates.get(template.id);
      if (existing && JSON.stringify(toCardTemplate(existing)) === JSON.stringify(template))
        continue;
      const frontmatter = stringify({
        ...sourceFields(existing),
        schema_version: 1,
        id: template.id,
        name: template.name,
        card: {
          title: template.title,
          column_id: template.columnId,
          tag_ids: template.tagIds,
          due: dueToSource(template.due),
        },
        checklist: template.checklist,
        created_at: existing?.created_at ?? now.toISOString(),
        updated_at: now.toISOString(),
      });
      await transaction.write(
        join(templatesDir, `${template.id}.md`),
        `---\n${frontmatter}---\n${template.body}`.replace(/\n*$/, "\n"),
      );
    }
    for (const id of request.deletedIds) await transaction.remove(join(templatesDir, `${id}.md`));

    const after = await validateWorkspace(root);
    if (after.errors.length > 0)
      throw new Error(
        validationMessage(after) || "Workspace validation failed after saving templates.",
      );
    transaction.commit();
  } catch (error) {
    await rollbackAndRethrow(transaction, error);
  }
  return { path: templatesDir };
}
