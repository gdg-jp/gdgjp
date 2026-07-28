const URL_PATTERN = /https?:\/\/[^\s]+/i;

function meta(html: string, property: string): string | null {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, "i"),
  ];
  return patterns.map((pattern) => pattern.exec(html)?.[1] ?? null).find(Boolean) ?? null;
}

export async function fetchLinkPreview(text: string): Promise<{
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
} | null> {
  const found = text.match(URL_PATTERN)?.[0];
  if (!found) return null;
  const url = new URL(found);
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    /^(127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host)
  )
    return null;
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(5_000),
    headers: { "User-Agent": "GDG-SNS-Manager/1.0 link preview" },
  });
  if (!response.ok || !response.headers.get("content-type")?.includes("text/html"))
    return { url: url.toString(), title: null, description: null, imageUrl: null };
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > 256_000)
    return { url: url.toString(), title: null, description: null, imageUrl: null };
  const html = (await response.text()).slice(0, 256_000);
  return {
    url: response.url,
    title: meta(html, "twitter:title") ?? meta(html, "og:title"),
    description: meta(html, "twitter:description") ?? meta(html, "og:description"),
    imageUrl: meta(html, "twitter:image") ?? meta(html, "og:image"),
  };
}
