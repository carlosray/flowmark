import type { TagColor } from "./types";

export const TAG_COLORS: TagColor[] = ["slate", "blue", "green", "amber", "rose", "violet", "teal"];

export const tagColorVar: Record<TagColor, string> = {
  slate: "var(--tag-slate)",
  blue: "var(--tag-blue)",
  green: "var(--tag-green)",
  amber: "var(--tag-amber)",
  rose: "var(--tag-rose)",
  violet: "var(--tag-violet)",
  teal: "var(--tag-teal)",
};
