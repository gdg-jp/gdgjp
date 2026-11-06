/**
 * Durable Object name of a page's collaboration room. Rooms are per (space, slug) because
 * slugs are unique only within a space. The migrated default space keeps the v1 name (the
 * bare slug) so rooms with persisted Yjs state survive the spaces migration.
 */
export function collabRoomName(spaceId: string, slug: string): string {
  return spaceId === "gdg-jp" ? slug : `${spaceId}/${slug}`;
}
