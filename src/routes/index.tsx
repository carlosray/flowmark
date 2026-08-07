import { createFileRoute, getRouteApi, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { Board } from "@/components/board/Board";
import { parseCardSearch } from "@/lib/card-deep-link";
import { getExpandedChecklistCardIds } from "@/lib/checklist-expansion.functions";

const rootRoute = getRouteApi("__root__");

export const Route = createFileRoute("/")({
  validateSearch: parseCardSearch,
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
  const { card } = Route.useSearch();
  const navigate = useNavigate({ from: "/" });
  const setOpenCardId = useCallback(
    (cardId: string | null) =>
      void navigate({ search: cardId ? { card: cardId } : {}, replace: true }),
    [navigate],
  );
  return (
    <Board
      initialTheme={theme}
      initialExpandedChecklistCardIds={initialExpandedChecklistCardIds}
      initialOpenCardId={card}
      onOpenCardIdChange={setOpenCardId}
    />
  );
}
