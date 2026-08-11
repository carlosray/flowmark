import { createContext } from "react";

import type { Card } from "@/lib/types";

export interface CardLinkContextValue {
  cards: Record<string, Card>;
  workspacePath: string | null;
  openCard: (cardId: string) => void;
}

export const CardLinkContext = createContext<CardLinkContextValue | null>(null);
