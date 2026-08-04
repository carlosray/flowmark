export function resolveMarkdownEdit(
  original: string,
  draft: string,
  cancelled: boolean,
  normalize: (value: string) => string = (value) => value,
) {
  if (cancelled) return { value: original, shouldSave: false };
  const value = normalize(draft);
  return { value, shouldSave: value !== original };
}

export function editableMarkdownKeyAction(
  event: { key: string; metaKey: boolean; ctrlKey: boolean },
  multiline: boolean,
): "save" | "cancel" | null {
  if (event.key === "Escape") return "cancel";
  if (event.key !== "Enter") return null;
  if (!multiline || event.metaKey || event.ctrlKey) return "save";
  return null;
}

export function resizeMarkdownEditor(editor: {
  scrollHeight: number;
  style: { height: string };
}): void {
  editor.style.height = "0px";
  editor.style.height = `${Math.max(96, editor.scrollHeight)}px`;
}
