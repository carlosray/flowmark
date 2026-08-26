import { useSyncExternalStore } from "react";

import { getTemplatesFile, saveTemplatesFile } from "./templates.functions";
import type { CardTemplate } from "./workspace/templates-repository";

export type { CardTemplate, TemplateDue } from "./workspace/templates-repository";

export type TemplatesStatus = "idle" | "loading" | "saving" | "saved" | "error";

export interface TemplatesSnapshot {
  status: TemplatesStatus;
  path: string | null;
  error: string | null;
  locale: string;
  timeZone: string;
}

export interface TemplatesPersistence {
  read: () => Promise<{
    path: string;
    templates: CardTemplate[];
    locale: string;
    timeZone: string;
  }>;
  save: (request: { templates: CardTemplate[]; deletedIds: string[] }) => Promise<{ path: string }>;
}

const defaultPersistence: TemplatesPersistence = {
  read: async () => {
    const result = await getTemplatesFile();
    const parsed = JSON.parse(result.json);
    return {
      path: result.path,
      locale: result.locale,
      timeZone: result.timeZone,
      templates: Array.isArray(parsed) ? (parsed as CardTemplate[]) : [],
    };
  },
  save: async ({ templates, deletedIds }) =>
    saveTemplatesFile({
      data: { json: `${JSON.stringify(templates, null, 2)}\n`, deletedIds },
    }),
};

export class TemplatesStore {
  private templates: CardTemplate[] = [];
  private deletedIds = new Set<string>();
  private listeners = new Set<() => void>();
  private hydrated = false;
  private snapshot: TemplatesSnapshot = {
    status: "idle",
    path: null,
    error: null,
    locale: "en",
    timeZone: "UTC",
  };

  constructor(private readonly persistence: TemplatesPersistence = defaultPersistence) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.templates;
  getSyncSnapshot = () => this.snapshot;

  private emit() {
    for (const listener of this.listeners) listener();
  }

  private setSync(patch: Partial<TemplatesSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
  }

  hydrate() {
    if (this.hydrated) return;
    this.hydrated = true;
    void this.reload();
  }

  async reload() {
    this.setSync({ status: "loading", error: null });
    this.emit();
    try {
      const result = await this.persistence.read();
      this.templates = result.templates;
      this.deletedIds.clear();
      this.setSync({
        status: "saved",
        path: result.path,
        error: null,
        locale: result.locale,
        timeZone: result.timeZone,
      });
    } catch (error) {
      this.setSync({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
    this.emit();
  }

  /**
   * Saving is explicit rather than debounced: a half-finished template is a
   * validation error, so it must not reach disk on every keystroke.
   */
  async save(next: CardTemplate[]) {
    const deleted = [...this.deletedIds];
    this.setSync({ status: "saving", error: null });
    this.templates = next;
    this.emit();
    try {
      const result = await this.persistence.save({ templates: next, deletedIds: deleted });
      this.deletedIds.clear();
      this.setSync({ status: "saved", path: result.path, error: null });
      this.emit();
      return true;
    } catch (error) {
      this.setSync({
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      this.emit();
      return false;
    }
  }

  async upsert(template: CardTemplate) {
    const exists = this.templates.some((candidate) => candidate.id === template.id);
    const next = exists
      ? this.templates.map((candidate) => (candidate.id === template.id ? template : candidate))
      : [...this.templates, template];
    return this.save(next);
  }

  async remove(id: string) {
    this.deletedIds.add(id);
    return this.save(this.templates.filter((candidate) => candidate.id !== id));
  }
}

export const templatesStore = new TemplatesStore();

export function useTemplates() {
  return useSyncExternalStore(
    templatesStore.subscribe,
    templatesStore.getSnapshot,
    templatesStore.getSnapshot,
  );
}

export function useTemplatesSync() {
  return useSyncExternalStore(
    templatesStore.subscribe,
    templatesStore.getSyncSnapshot,
    templatesStore.getSyncSnapshot,
  );
}
