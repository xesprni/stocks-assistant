import type { Conversation } from "@/types/app";

/** A failed bulk command may restore missing rows, but never undo later local work. */
export function reconcileConversationClear({ current, persisted, snapshot, deletedIds, limit = 50 }: {
  current: Conversation[]; persisted: Conversation[]; snapshot: Conversation[]; deletedIds: ReadonlySet<string>; limit?: number;
}): Conversation[] {
  const result = current.filter((item) => !deletedIds.has(item.id));
  const present = new Set(result.map((item) => item.id));
  const previous = new Map(snapshot.map((item) => [item.id, item]));
  for (const row of persisted) {
    if (present.has(row.id) || deletedIds.has(row.id)) continue;
    const old = previous.get(row.id);
    result.push({ ...old, ...row, messages: row.messages.length ? row.messages : old?.messages ?? [] });
    present.add(row.id);
  }
  return result.slice(0, limit);
}
