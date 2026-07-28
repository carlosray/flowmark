export function matchesTagFilter(cardTagIds: string[], selectedTagIds: string[]) {
  return selectedTagIds.every((tagId) => cardTagIds.includes(tagId));
}
