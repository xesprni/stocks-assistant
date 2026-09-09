/** Restore only the failed entity; subsequent deletes, additions and edits remain intact. */
export function restoreEntity<T extends { id: string | number }>(current: T[], item: T, previous: T[]): T[] {
  if (current.some((value) => value.id === item.id)) return current;
  const originalIndex = previous.findIndex((value) => value.id === item.id);
  const successor = previous.slice(originalIndex + 1).find((value) => current.some((entry) => entry.id === value.id));
  const index = successor ? current.findIndex((value) => value.id === successor.id) : current.length;
  return [...current.slice(0, index), item, ...current.slice(index)];
}

export function applyEntityOrder<T extends { id: string | number }>(items: T[], ids: Array<T["id"]>): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered = ids.flatMap((id) => {
    const item = byId.get(id);
    byId.delete(id);
    return item ? [item] : [];
  });
  return [...ordered, ...byId.values()];
}
