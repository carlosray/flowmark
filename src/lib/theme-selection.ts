import type { ThemeId } from "./themes";

export async function persistThemeSelection({
  previous,
  next,
  apply,
  save,
}: {
  previous: ThemeId;
  next: ThemeId;
  apply: (theme: ThemeId) => void;
  save: (theme: ThemeId) => Promise<void>;
}): Promise<{ theme: ThemeId; error: string | null }> {
  apply(next);
  try {
    await save(next);
    return { theme: next, error: null };
  } catch (error) {
    apply(previous);
    return {
      theme: previous,
      error: `Could not save theme: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
