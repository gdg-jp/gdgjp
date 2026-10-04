import { runtimeCache, runtimeCacheFailure, sharedCacheKeysForTests } from "./runtime-cache.js";
const DNS_TTL_MS = 5 * 60_000;
const DNS_CACHE_LIMIT = 200;
const SHARED_DNS_TTL_SECONDS = 60 * 60;
const DNS_QUERY_ENDPOINT = "https://cloudflare-dns.com/dns-query";
const dnsCache = new Map<string, { safe: boolean; expiresAt: number }>();

export function clearUpstreamDnsCacheForTests(): void {
  dnsCache.clear();
}

function isIpv4(ip: string): boolean {
  const parts = ip.split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function isIpLiteral(hostname: string): boolean {
  return isIpv4(hostname) || hostname.includes(":");
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  return (
    parts[0] === 0 ||
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    parts[0] >= 224
  );
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.")
  );
}

type DnsJsonResponse = {
  Status?: number;
  Answer?: Array<{ data?: string; type?: number; TTL?: number }>;
};

async function queryAddresses(hostname: string, type: "A" | "AAAA"): Promise<string[]> {
  const query = new URL(DNS_QUERY_ENDPOINT);
  query.searchParams.set("name", hostname);
  query.searchParams.set("type", type);
  const response = await fetch(query, {
    headers: { accept: "application/dns-json" },
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok) throw new Error("DNS lookup failed");
  const data = (await response.json()) as DnsJsonResponse;
  if (typeof data.Status === "number" && data.Status !== 0 && data.Status !== 3) {
    throw new Error("DNS lookup failed");
  }
  const expectedType = type === "A" ? 1 : 28;
  return (data.Answer ?? []).flatMap((answer) =>
    answer.type === expectedType && answer.data ? [answer.data.trim()] : [],
  );
}

async function resolvesOnlyToPublicAddresses(hostname: string): Promise<boolean> {
  const cached = dnsCache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) return cached.safe;
  const sharedKey = `dns:${hostname}`;
  sharedCacheKeysForTests.add(sharedKey);
  const shared = await runtimeCache.get(sharedKey).catch((error) => {
    runtimeCacheFailure("get", sharedKey, error);
    return null;
  });
  if (typeof shared === "boolean") {
    dnsCache.set(hostname, { safe: shared, expiresAt: Date.now() + DNS_TTL_MS });
    return shared;
  }
  const [ipv4, ipv6] = await Promise.all([
    queryAddresses(hostname, "A"),
    queryAddresses(hostname, "AAAA"),
  ]);
  const safe =
    ipv4.length + ipv6.length > 0 &&
    ipv4.every((address) => isIpv4(address) && !isPrivateIpv4(address)) &&
    ipv6.every((address) => address.includes(":") && !isPrivateIpv6(address));
  if (dnsCache.size >= DNS_CACHE_LIMIT) dnsCache.delete(dnsCache.keys().next().value ?? "");
  dnsCache.set(hostname, { safe, expiresAt: Date.now() + DNS_TTL_MS });
  await runtimeCache
    .set(sharedKey, safe, {
      ttl: SHARED_DNS_TTL_SECONDS,
      tags: [`domain-${hostname.replace(/^origin\./, "")}`],
    })
    .catch((error) => runtimeCacheFailure("set", sharedKey, error));
  return safe;
}

export async function validateUpstreamOrigin(origin: string, publicHostname: string): Promise<URL> {
  const url = new URL(origin);
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.origin !== origin ||
    isIpLiteral(hostname) ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname === publicHostname ||
    hostname === "gdgs.jp" ||
    hostname.endsWith(".gdgs.jp") ||
    hostname === "vercel.app" ||
    hostname.endsWith(".vercel.app")
  ) {
    throw new Error("Unsafe upstream origin");
  }
  if (!(await resolvesOnlyToPublicAddresses(hostname))) {
    throw new Error("Upstream resolves to a private address");
  }
  return url;
}
