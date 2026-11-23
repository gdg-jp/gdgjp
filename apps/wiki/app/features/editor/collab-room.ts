export function collabRoomName(spaceId: string, slug: string): string {
  return spaceId === "gdg-jp" ? slug : `${spaceId}/${slug}`;
}
