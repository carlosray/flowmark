export const THEME_IDS = [
  "flow-neutral",
  "one-dark",
  "nord",
  "catppuccin-mocha",
  "tokyo-night",
  "gruvbox-dark",
  "solarized-light",
  "rose-pine",
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export type ThemeMeta = {
  id: ThemeId;
  label: string;
  swatch: readonly [string, string, string, string];
  kind: "light" | "dark";
};

export const DEFAULT_THEME: ThemeId = "flow-neutral";

export const THEMES: readonly ThemeMeta[] = [
  {
    id: "flow-neutral",
    label: "Flow Neutral",
    kind: "dark",
    swatch: ["#3a3733", "#4a4642", "#7ab5ea", "#c9a068"],
  },
  {
    id: "one-dark",
    label: "One Dark",
    kind: "dark",
    swatch: ["#282c34", "#21252b", "#61afef", "#c678dd"],
  },
  {
    id: "nord",
    label: "Nord",
    kind: "dark",
    swatch: ["#2e3440", "#3b4252", "#88c0d0", "#a3be8c"],
  },
  {
    id: "catppuccin-mocha",
    label: "Catppuccin Mocha",
    kind: "dark",
    swatch: ["#1e1e2e", "#313244", "#89b4fa", "#f5c2e7"],
  },
  {
    id: "tokyo-night",
    label: "Tokyo Night",
    kind: "dark",
    swatch: ["#1a1b26", "#24283b", "#7aa2f7", "#bb9af7"],
  },
  {
    id: "gruvbox-dark",
    label: "Gruvbox Dark",
    kind: "dark",
    swatch: ["#282828", "#3c3836", "#83a598", "#d79921"],
  },
  {
    id: "solarized-light",
    label: "Solarized Light",
    kind: "light",
    swatch: ["#fdf6e3", "#eee8d5", "#268bd2", "#b58900"],
  },
  {
    id: "rose-pine",
    label: "Rosé Pine",
    kind: "dark",
    swatch: ["#191724", "#1f1d2e", "#c4a7e7", "#ebbcba"],
  },
];

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && (THEME_IDS as readonly string[]).includes(value);
}

type ThemeRoot = {
  setAttribute(name: string, value: string): void;
  classList: { toggle(name: string, force: boolean): unknown };
};

export function isLightTheme(theme: ThemeId) {
  return THEMES.find((candidate) => candidate.id === theme)?.kind === "light";
}

export function applyTheme(theme: ThemeId, root?: ThemeRoot) {
  if (!isThemeId(theme)) throw new Error(`Invalid theme ID: ${String(theme)}`);
  const target = root ?? (typeof document === "undefined" ? undefined : document.documentElement);
  if (!target) return;
  target.setAttribute("data-theme", theme);
  target.classList.toggle("dark", !isLightTheme(theme));
}

export function themeBootstrapScript(theme: ThemeId) {
  if (!isThemeId(theme)) throw new Error(`Invalid theme ID: ${String(theme)}`);
  return `(function(){var r=document.documentElement;r.setAttribute('data-theme',${JSON.stringify(theme)});r.classList.toggle('dark',${String(!isLightTheme(theme))});})();`;
}
