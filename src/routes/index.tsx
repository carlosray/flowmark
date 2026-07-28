import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { Board } from "@/components/board/Board";
import { getExpandedChecklistCardIds } from "@/lib/checklist-expansion.functions";

const rootRoute = getRouteApi("__root__");

export const Route = createFileRoute("/")({
  loader: () => getExpandedChecklistCardIds(),
  component: Index,
  head: () => ({
    meta: [
      { title: "Flowmark — Local-first Markdown Kanban" },
      {
        name: "description",
        content:
          "A calm, keyboard-friendly Kanban board for daily planning. Local-first, Markdown source of truth.",
      },
      { property: "og:title", content: "Flowmark — Local-first Markdown Kanban" },
      {
        property: "og:description",
        content:
          "A calm, keyboard-friendly Kanban board for daily planning. Local-first, Markdown source of truth.",
      },
    ],
  }),
});

function Index() {
  const theme = rootRoute.useLoaderData();
  const initialExpandedChecklistCardIds = Route.useLoaderData();
  return (
    <Board initialTheme={theme} initialExpandedChecklistCardIds={initialExpandedChecklistCardIds} />
  );
}
