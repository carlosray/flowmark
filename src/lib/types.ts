export type TagColor = "slate" | "blue" | "green" | "amber" | "rose" | "violet" | "teal";

export interface Tag {
  id: string;
  name: string;
  color: TagColor;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface Comment {
  id: string;
  body: string;
  createdAt: string;
}

export type Recurrence =
  | { kind: "none" }
  | { kind: "daily" }
  | { kind: "weekdays" }
  | { kind: "weekly"; weekday: number } // 0=Sun
  | { kind: "monthly"; day: number };

export interface Card {
  id: string;
  title: string;
  description: string;
  dueDate: string | null; // ISO date
  checklist: ChecklistItem[];
  comments: Comment[];
  tagIds: string[];
  completed: boolean;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  recurrence?: Recurrence;
}

export interface Column {
  id: string;
  name: string;
  cardIds: string[];
  collapsed?: boolean;
}

export interface Board {
  columns: Column[];
  cards: Record<string, Card>;
  tags: Tag[];
}
