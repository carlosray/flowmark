# Exact card ID search design

## Goal

Let the board search field find one card by its complete immutable ID, using
either the full `card_gycbfxxzw5au` form or the generated 12-character suffix
`gycbfxxzw5au`, without making partial random-ID fragments match many cards.

## Search behavior

Search queries are normalized to lowercase. A query containing exactly 12
letters or digits is treated as a generated card ID suffix and normalized to
`card_<query>`. A query that already has the canonical `card_` prefix is used as
the full candidate ID.

Either ID-shaped form switches search into ID-only mode: a card matches only
when its complete `card.id` equals the normalized candidate. Card titles,
descriptions, checklist items, and comments are ignored in this mode. Partial
IDs do not match.

Queries that are not ID-shaped keep the existing case-insensitive substring
search across title, description, checklist text, and comment bodies. Tag, due,
and completion filters continue to combine with the search result unchanged.

## Implementation

A pure `matchesCardSearch(card, query)` helper in `src/lib/board-filters.ts`
owns query classification and matching. `Board.tsx` delegates only the search
part of its existing composed filter to this helper. No UI, storage, route, or
workspace-format changes are required.

Tests cover full IDs, bare 12-character suffixes, case normalization, partial
IDs, ID-shaped strings present only in card prose, ordinary text search, and
the source-level Board integration.
