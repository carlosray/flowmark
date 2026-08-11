const CARD_ID_PATTERN = /^card_[a-z0-9]+(?:_[a-z0-9]+)*$/;

export const CARD_LINK_FORMATS = ["terminal", "raw", "markdown"] as const;

export type CardLinkFormat = (typeof CARD_LINK_FORMATS)[number];

export function isCardLinkFormat(value: unknown): value is CardLinkFormat {
  return CARD_LINK_FORMATS.some((format) => format === value);
}

export function formatFlowmarkCardLink(url: string, format: CardLinkFormat) {
  if (format === "terminal") {
    return `\u001b]8;;${url}\u001b\\Open in Flowmark\u001b]8;;\u001b\\`;
  }
  if (format === "markdown") return `[Open in Flowmark](${url})`;
  return url;
}

function isAbsoluteWorkspacePath(value: string) {
  return value.startsWith("/");
}

function assertCardId(cardId: string) {
  if (!CARD_ID_PATTERN.test(cardId)) {
    throw new Error(`Invalid Flowmark card ID: ${cardId}`);
  }
}

export function buildFlowmarkCardUrl(workspacePath: string, cardId: string) {
  if (!isAbsoluteWorkspacePath(workspacePath)) {
    throw new Error(`Invalid Flowmark workspace path: ${workspacePath}`);
  }
  assertCardId(cardId);
  const url = new URL("flowmark://open");
  url.searchParams.set("workspace", workspacePath);
  url.searchParams.set("card", cardId);
  return url.toString();
}

export function parseFlowmarkCardUrl(value: string) {
  const invalid = () => new Error(`Invalid Flowmark card link: ${value}`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid();
  }
  const workspacePath = url.searchParams.get("workspace");
  const cardId = url.searchParams.get("card");
  if (
    url.protocol !== "flowmark:" ||
    url.hostname !== "open" ||
    url.pathname !== "" ||
    !workspacePath ||
    !isAbsoluteWorkspacePath(workspacePath) ||
    !cardId ||
    !CARD_ID_PATTERN.test(cardId)
  ) {
    throw invalid();
  }
  return { workspacePath, cardId };
}

export function isCardReferenceUrl(value: string) {
  return value.startsWith("flowmark://card_") || value.startsWith("flowmark://open");
}

/**
 * Resolve a card reference URL to a card ID in this workspace.
 * Same-workspace shorthand `flowmark://card_<id>` always resolves.
 * Full `flowmark://open?workspace=...&card=...` links resolve only when the
 * workspace path matches the current one; cross-workspace links never render.
 */
export function resolveCardReferenceTarget(value: string, workspacePath: string | null) {
  if (value.startsWith("flowmark://card_")) {
    try {
      const url = new URL(value);
      if (url.protocol !== "flowmark:" || url.pathname !== "" || url.search !== "") return null;
      const cardId = url.hostname;
      return isCardId(cardId) ? cardId : null;
    } catch {
      return null;
    }
  }
  if (!value.startsWith("flowmark://open") || !workspacePath) return null;
  try {
    const parsed = parseFlowmarkCardUrl(value);
    const normalize = (path: string) => path.replace(/\/+$/, "");
    return normalize(parsed.workspacePath) === normalize(workspacePath) ? parsed.cardId : null;
  } catch {
    return null;
  }
}

export function buildSessionCardUrl(sessionUrl: string, cardId: string) {
  assertCardId(cardId);
  const url = new URL(sessionUrl);
  url.searchParams.set("card", cardId);
  return url.toString();
}

export function isCardId(value: unknown): value is string {
  return typeof value === "string" && CARD_ID_PATTERN.test(value);
}
