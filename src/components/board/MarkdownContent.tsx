import type { Root } from "mdast";
import ReactMarkdown, { type Components } from "react-markdown";

type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
};

const BARE_URL = /\b(?:https?:\/\/|www\.)[^\s<]+/gi;
const NON_LINK_PARENTS = new Set(["code", "inlineCode", "link", "linkReference"]);

function splitTrailingPunctuation(value: string): [string, string] {
  let url = value;
  let trailing = "";

  while (/[.,;:!?]$/.test(url)) {
    trailing = `${url.at(-1)}${trailing}`;
    url = url.slice(0, -1);
  }

  for (const [opening, closing] of [
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
  ] as const) {
    while (url.endsWith(closing) && url.split(closing).length > url.split(opening).length) {
      trailing = `${closing}${trailing}`;
      url = url.slice(0, -1);
    }
  }

  return [url, trailing];
}

function linkifyText(value: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  let cursor = 0;

  for (const match of value.matchAll(BARE_URL)) {
    const start = match.index;
    if (start > cursor) nodes.push({ type: "text", value: value.slice(cursor, start) });

    const matched = match[0];
    const [label, trailing] = splitTrailingPunctuation(matched);
    if (label) {
      nodes.push({
        type: "link",
        url: label.startsWith("www.") ? `http://${label}` : label,
        children: [{ type: "text", value: label }],
      } as MarkdownNode & { url: string });
    }
    if (trailing) nodes.push({ type: "text", value: trailing });
    cursor = start + matched.length;
  }

  if (cursor < value.length) nodes.push({ type: "text", value: value.slice(cursor) });
  return nodes.length > 0 ? nodes : [{ type: "text", value }];
}

function transformTextNodes(parent: MarkdownNode) {
  if (!parent.children || NON_LINK_PARENTS.has(parent.type)) return;

  parent.children = parent.children.flatMap((child) => {
    if (child.type === "text" && typeof child.value === "string") return linkifyText(child.value);
    transformTextNodes(child);
    return child;
  });
}

export function remarkBareLinks() {
  return (tree: Root) => transformTextNodes(tree as unknown as MarkdownNode);
}

const markdownComponents = {
  a: ({ node: _node, ...props }) => (
    <a
      {...props}
      target="_blank"
      rel="noopener noreferrer"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      className="font-medium text-primary underline decoration-primary/50 underline-offset-2 transition-colors hover:text-primary/80 hover:decoration-primary"
    />
  ),
} satisfies Components;

export function MarkdownContent({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkBareLinks]} components={markdownComponents}>
      {children}
    </ReactMarkdown>
  );
}

export function MarkdownInline({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkBareLinks]}
      components={markdownComponents}
      allowedElements={["a", "strong", "em", "del", "code", "br"]}
      unwrapDisallowed
    >
      {children}
    </ReactMarkdown>
  );
}
