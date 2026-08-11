import type { Root } from "mdast";
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
  type UrlTransform,
} from "react-markdown";

import { isCardReferenceUrl } from "@/lib/card-links";
import { CardLink } from "./CardLink";

type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
};

const BARE_URL = /\b(?:https?:\/\/|www\.)[^\s<]+|flowmark:\/\/[^\s<]+/gi;
const NON_LINK_PARENTS = new Set(["code", "inlineCode", "link", "linkReference"]);

const urlTransform: UrlTransform = (value) =>
  isCardReferenceUrl(value) ? value : defaultUrlTransform(value);

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

function linkifyText(value: string, linkifyCardLinks: boolean): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  let cursor = 0;

  for (const match of value.matchAll(BARE_URL)) {
    const start = match.index;
    const matched = match[0];
    if (isCardReferenceUrl(matched) && !linkifyCardLinks) continue;

    if (start > cursor) nodes.push({ type: "text", value: value.slice(cursor, start) });

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

function transformTextNodes(parent: MarkdownNode, linkifyCardLinks: boolean) {
  if (!parent.children || NON_LINK_PARENTS.has(parent.type)) return;

  parent.children = parent.children.flatMap((child) => {
    if (child.type === "text" && typeof child.value === "string") {
      return linkifyText(child.value, linkifyCardLinks);
    }
    transformTextNodes(child, linkifyCardLinks);
    return child;
  });
}

export function remarkBareLinks(linkifyCardLinks = false) {
  return () => (tree: Root) =>
    transformTextNodes(tree as unknown as MarkdownNode, linkifyCardLinks);
}

function MarkdownAnchor({ node: _node, ...props }: React.ComponentProps<"a"> & { node?: unknown }) {
  return (
    <a
      {...props}
      target="_blank"
      rel="noopener noreferrer"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      className="font-medium text-primary underline decoration-primary/50 underline-offset-2 transition-colors hover:text-primary/80 hover:decoration-primary"
    />
  );
}

function textContentOf(children: React.ReactNode): string {
  if (children === null || children === undefined || typeof children === "boolean") return "";
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(textContentOf).join("");
  if (typeof children === "object" && "props" in children) {
    return textContentOf(
      (children as React.ReactElement<{ children?: React.ReactNode }>).props.children,
    );
  }
  return "";
}

function CardAwareAnchor({
  node: _node,
  href,
  children,
  ...rest
}: React.ComponentProps<"a"> & { node?: unknown }) {
  if (href && isCardReferenceUrl(href)) {
    // Bare `flowmark://card_x` references (label equals the URL) render as a
    // card chip; authored Markdown links keep their label and link styling.
    return (
      <CardLink href={href} bare={textContentOf(children) === href}>
        {children}
      </CardLink>
    );
  }
  return (
    <MarkdownAnchor href={href} {...rest}>
      {children}
    </MarkdownAnchor>
  );
}

const markdownComponents = { a: MarkdownAnchor } satisfies Components;
const cardLinkComponents = { a: CardAwareAnchor } satisfies Components;

export function MarkdownContent({
  children,
  cardLinks = false,
}: {
  children: string;
  cardLinks?: boolean;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkBareLinks(cardLinks)]}
      urlTransform={cardLinks ? urlTransform : undefined}
      components={cardLinks ? cardLinkComponents : markdownComponents}
    >
      {children}
    </ReactMarkdown>
  );
}

export function MarkdownInline({ children }: { children: string }) {
  // Titles and other inline text never resolve card reference links.
  return (
    <ReactMarkdown
      remarkPlugins={[remarkBareLinks(false)]}
      components={markdownComponents}
      allowedElements={["a", "strong", "em", "del", "code", "br"]}
      unwrapDisallowed
    >
      {children}
    </ReactMarkdown>
  );
}
