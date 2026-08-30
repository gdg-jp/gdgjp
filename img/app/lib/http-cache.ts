export const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=300, s-maxage=86400",
  "Accept-CH": "Sec-CH-UA-Mobile",
};

export function matchesEtag(header: string | null, etag: string): boolean {
  if (!header) return false;
  for (const raw of header.split(",")) {
    let token = raw.trim();
    if (token === "*") return true;
    if (token.startsWith("W/")) token = token.slice(2);
    if (token === etag) return true;
  }
  return false;
}

export function cacheHeaders(etag: string, extras: HeadersInit = {}): Headers {
  return new Headers({ ...CACHE_HEADERS, ETag: etag, ...Object.fromEntries(new Headers(extras)) });
}

export function notModified(headers: HeadersInit): Response {
  return new Response(null, { status: 304, headers });
}

export function varyHeader(accept: boolean, deviceVary?: string): string | undefined {
  const value = [accept ? "Accept" : undefined, deviceVary].filter(Boolean).join(", ");
  return value || undefined;
}

export async function cachePut(
  cache: Pick<Cache, "put"> | null,
  request: Request,
  response: Response,
) {
  if (!cache || !response.ok) return;
  const cached = response.clone();
  cached.headers.delete("Vary");
  await cache.put(request, cached);
}
