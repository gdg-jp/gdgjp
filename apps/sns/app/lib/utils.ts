export const JST_TIME_ZONE = "Asia/Tokyo";

export function nowIso(): string {
  return new Date().toISOString();
}

export function chapterName(slug: string): string {
  return slug
    .split("-")
    .filter((part, index) => !(index === 0 && part.toLowerCase() === "gdg"))
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
