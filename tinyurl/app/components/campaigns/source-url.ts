export const SOURCE_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export function campaignSourceUrl(shortUrl: string, source: string): string | null {
  const normalized = source.trim().toLowerCase();
  if (!SOURCE_CODE_PATTERN.test(normalized)) return null;
  const url = new URL(shortUrl);
  url.searchParams.set("s", normalized);
  return url.toString();
}
