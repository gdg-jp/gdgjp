export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const JST_TIME_ZONE = "Asia/Tokyo";

export function nowIso(): string {
  return new Date().toISOString();
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function safeReturnTo(value: string | null | undefined): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/posts";
}

export function chapterName(slug: string): string {
  return slug
    .split("-")
    .filter((part, index) => !(index === 0 && part.toLowerCase() === "gdg"))
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
