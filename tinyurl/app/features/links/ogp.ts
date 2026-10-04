export type OgpData = {
  title: string | null;
  description: string | null;
  image: string | null;
};

const MAX_BYTES = 256 * 1024;
const TIMEOUT_MS = 3000;
const MAX_REDIRECTS = 5;
const DNS_TIMEOUT_MS = 2000;

const PRIVATE_HOSTS =
  /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|::1$|fc[0-9a-f]{2}:|fd[0-9a-f]{2}:)/i;
const PRIVATE_RANGE_172 = /^172\.(1[6-9]|2[0-9]|3[01])\./;
const DNS_QUERY_ENDPOINT = "https://cloudflare-dns.com/dns-query";

type DnsJsonResponse = {
  Answer?: Array<{
    data?: string;
    type?: number;
  }>;
};

function isPrivateHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  if (PRIVATE_HOSTS.test(normalized)) return true;
  if (PRIVATE_RANGE_172.test(normalized)) return true;
  return false;
}

function normalizeHostname(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
}

function isIPv4Address(value: string): boolean {
  const parts = value.split(".");
  return (
    parts.length === 4 &&
    parts.every((part) => {
      if (!/^\d+$/.test(part)) return false;
      const n = Number(part);
      return n >= 0 && n <= 255 && String(n) === part;
    })
  );
}

function isPrivateIPv4(address: string): boolean {
  const [a, b, c] = address.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isPrivateIPv6(address: string): boolean {
  const normalized = normalizeHostname(address);
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (/^fe[89ab]:/i.test(normalized)) return true;
  if (normalized.startsWith("ff")) return true;
  if (normalized.startsWith("2001:db8:") || normalized === "2001:db8::") return true;

  const ipv4Mapped = /(?:^|:)ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(normalized);
  return ipv4Mapped ? isPrivateIPv4(ipv4Mapped[1]) : false;
}

export function isPrivateIP(address: string): boolean {
  const normalized = normalizeHostname(address);
  if (isIPv4Address(normalized)) return isPrivateIPv4(normalized);
  if (normalized.includes(":")) return isPrivateIPv6(normalized);
  return false;
}

async function resolveHostname(hostname: string, type: "A" | "AAAA"): Promise<string[]> {
  const query = new URL(DNS_QUERY_ENDPOINT);
  query.searchParams.set("name", hostname);
  query.searchParams.set("type", type);

  const response = await fetch(query.toString(), {
    headers: { accept: "application/dns-json" },
    signal: AbortSignal.timeout(DNS_TIMEOUT_MS),
  });
  if (!response.ok) {
    console.error(
      `DoH lookup failed: ${response.status} ${response.statusText} (${query.toString()})`,
    );
    return [];
  }

  const data = (await response.json()) as DnsJsonResponse;
  const expectedType = type === "A" ? 1 : 28;
  return (
    data.Answer?.filter((answer) => answer.type === expectedType && answer.data)
      .map((answer) => answer.data as string)
      .filter((answer) => isIPv4Address(normalizeHostname(answer)) || answer.includes(":")) ?? []
  );
}

async function resolvePublicAddresses(hostname: string): Promise<boolean> {
  const normalized = normalizeHostname(hostname);
  if (isPrivateHostname(normalized)) return false;
  if (isIPv4Address(normalized) || normalized.includes(":")) return !isPrivateIP(normalized);

  let addresses: string[];
  try {
    const [ipv4, ipv6] = await Promise.all([
      resolveHostname(normalized, "A"),
      resolveHostname(normalized, "AAAA"),
    ]);
    addresses = [...ipv4, ...ipv6];
  } catch {
    return false;
  }

  if (addresses.length === 0) return false;
  return addresses.every((address) => !isPrivateIP(address));
}

export async function validatePublicHttpUrl(
  url: string | URL,
): Promise<{ ok: true; url: URL } | { ok: false; reason: string }> {
  let parsed: URL;
  try {
    parsed = typeof url === "string" ? new URL(url) : new URL(url.toString());
  } catch {
    return { ok: false, reason: "URL is not valid." };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "URL must use http or https." };
  }

  if (!(await resolvePublicAddresses(parsed.hostname))) {
    return { ok: false, reason: "URL must not resolve to a private or loopback address." };
  }

  return { ok: true, url: parsed };
}

function pickMeta(html: string, property: string): string | null {
  const propMatch = new RegExp(
    `<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`,
    "i",
  ).exec(html);
  if (propMatch) return propMatch[1];
  const nameMatch = new RegExp(
    `<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']+)["']`,
    "i",
  ).exec(html);
  if (nameMatch) return nameMatch[1];
  const reverseMatch = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`,
    "i",
  ).exec(html);
  return reverseMatch?.[1] ?? null;
}

export async function fetchOgp(url: string): Promise<OgpData | null> {
  const validation = await validatePublicHttpUrl(url);
  if (!validation.ok) return null;

  let response: Response | null = null;
  let parsed = validation.url;
  try {
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
      response = await fetch(parsed.toString(), {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "user-agent": "GDGJapanLinks/1.0 (OGP fetcher)" },
      });

      if (response.status < 300 || response.status >= 400) break;

      const location = response.headers.get("location");
      if (!location || redirectCount === MAX_REDIRECTS) return null;

      const redirectValidation = await validatePublicHttpUrl(new URL(location, parsed));
      if (!redirectValidation.ok) return null;
      parsed = redirectValidation.url;
    }
  } catch {
    return null;
  }
  if (!response) return null;
  if (!response.ok) return null;
  const ct = response.headers.get("content-type") ?? "";
  if (!ct.includes("text/html") && !ct.includes("application/xhtml")) return null;

  const reader = response.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let html = "";
  let received = 0;
  try {
    while (received < MAX_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      received += value.byteLength;
      html += decoder.decode(value, { stream: true });
      if (received >= MAX_BYTES) break;
      if (/<\/head>/i.test(html)) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  const title = pickMeta(html, "og:title") ?? extractTitle(html);
  const description = pickMeta(html, "og:description") ?? pickMeta(html, "description");
  const image = pickMeta(html, "og:image");
  if (!title && !description && !image) return null;
  return { title, description, image };
}

function extractTitle(html: string): string | null {
  const m = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  return m ? m[1].trim() : null;
}
