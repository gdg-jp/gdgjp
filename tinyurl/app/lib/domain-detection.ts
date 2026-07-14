import type { DomainMode } from "./domains";
import { isPrivateIP } from "./ogp";

const DNS_QUERY_ENDPOINT = "https://cloudflare-dns.com/dns-query";
const DNS_TIMEOUT_MS = 2_000;
const HTTPS_TIMEOUT_MS = 4_000;
const MAX_REDIRECTS = 5;

type DnsRecordType = "A" | "AAAA" | "CNAME";

type DnsJsonResponse = {
  Status?: number;
  Answer?: Array<{ data?: string; type?: number }>;
};

export type DomainDnsObservation = {
  type: DnsRecordType;
  value: string;
  /** Only address records have a public/private assessment. */
  public: boolean | null;
};

export type DomainDnsStatus = "resolved" | "not-found" | "unsafe" | "error";
export type DomainHttpsStatus = "reachable" | "not-checked" | "unreachable" | "unsafe-redirect";

export type DomainDetection = {
  hostname: string;
  mode: DomainMode;
  existingSite: boolean;
  /**
   * A separate hostname is required before origin-first can be activated. This
   * is a suggested hostname, not proof that it has already been configured.
   */
  suggestedUpstreamOrigin: string | null;
  dns: {
    status: DomainDnsStatus;
    observations: DomainDnsObservation[];
  };
  https: {
    status: DomainHttpsStatus;
    statusCode: number | null;
    finalUrl: string | null;
  };
};

type DnsLookup = DomainDetection["dns"];

function normalizeHostname(hostname: string): string | null {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (
    !normalized ||
    normalized.length > 253 ||
    normalized.includes(":") ||
    normalized.split(".").some((label) => !/^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(label))
  ) {
    return null;
  }
  return normalized;
}

function cleanDnsValue(value: string): string {
  return value.trim().replace(/\.$/, "");
}

async function queryDns(hostname: string, type: DnsRecordType): Promise<DomainDnsObservation[]> {
  const query = new URL(DNS_QUERY_ENDPOINT);
  query.searchParams.set("name", hostname);
  query.searchParams.set("type", type);
  const response = await fetch(query, {
    headers: { accept: "application/dns-json" },
    signal: AbortSignal.timeout(DNS_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("DNS lookup failed");

  const data = (await response.json()) as DnsJsonResponse;
  if (typeof data.Status === "number" && data.Status !== 0 && data.Status !== 3) {
    throw new Error("DNS lookup failed");
  }
  const expectedType = type === "A" ? 1 : type === "AAAA" ? 28 : 5;
  return (data.Answer ?? []).flatMap((answer) => {
    if (answer.type !== expectedType || !answer.data) return [];
    const value = cleanDnsValue(answer.data);
    return [{ type, value, public: type === "CNAME" ? null : !isPrivateIP(value) }];
  });
}

async function inspectDns(hostname: string): Promise<DnsLookup> {
  const results = await Promise.allSettled([
    queryDns(hostname, "A"),
    queryDns(hostname, "AAAA"),
    queryDns(hostname, "CNAME"),
  ]);
  const observations = results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );
  const addresses = observations.filter((record) => record.type !== "CNAME");

  if (addresses.some((record) => record.public === false)) {
    return { status: "unsafe", observations };
  }
  if (addresses.length > 0) return { status: "resolved", observations };
  if (results.some((result) => result.status === "rejected")) {
    return { status: "error", observations };
  }
  return { status: "not-found", observations };
}

function emptyDetection(hostname: string, dns: DnsLookup): DomainDetection {
  return {
    hostname,
    mode: "short-only",
    existingSite: false,
    suggestedUpstreamOrigin: null,
    dns,
    https: { status: "not-checked", statusCode: null, finalUrl: null },
  };
}

async function inspectHttps(
  hostname: string,
): Promise<Pick<DomainDetection, "existingSite" | "mode" | "suggestedUpstreamOrigin" | "https">> {
  let current = new URL(`https://${hostname}/`);
  try {
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
      const response = await fetch(current, {
        method: "HEAD",
        redirect: "manual",
        signal: AbortSignal.timeout(HTTPS_TIMEOUT_MS),
        headers: { "user-agent": "GDGJapanLinks/1.0 (domain detection)" },
      });
      response.body?.cancel().catch(() => {});

      if (response.status < 300 || response.status >= 400) {
        return {
          existingSite: true,
          mode: "origin-first",
          suggestedUpstreamOrigin: `https://origin.${hostname}`,
          https: { status: "reachable", statusCode: response.status, finalUrl: current.toString() },
        };
      }

      const location = response.headers.get("location");
      if (!location || redirectCount === MAX_REDIRECTS) {
        return {
          existingSite: true,
          mode: "origin-first",
          suggestedUpstreamOrigin: `https://origin.${hostname}`,
          https: { status: "reachable", statusCode: response.status, finalUrl: current.toString() },
        };
      }

      const next = new URL(location, current);
      if (next.protocol !== "https:") {
        return {
          existingSite: false,
          mode: "short-only",
          suggestedUpstreamOrigin: null,
          https: { status: "unsafe-redirect", statusCode: response.status, finalUrl: null },
        };
      }
      const redirectHostname = normalizeHostname(next.hostname);
      const redirectDns = redirectHostname ? await inspectDns(redirectHostname) : null;
      if (!redirectHostname || redirectDns?.status !== "resolved") {
        return {
          existingSite: false,
          mode: "short-only",
          suggestedUpstreamOrigin: null,
          https: { status: "unsafe-redirect", statusCode: response.status, finalUrl: null },
        };
      }
      current = next;
    }
  } catch {
    // Network, TLS, timeout, and malformed redirect failures are deliberately
    // reduced to a UI-safe status rather than exposing provider details.
  }
  return {
    existingSite: false,
    mode: "short-only",
    suggestedUpstreamOrigin: null,
    https: { status: "unreachable", statusCode: null, finalUrl: null },
  };
}

/**
 * Inspects the current DNS and HTTPS endpoint before a custom domain is moved.
 * It performs no Node.js DNS calls, so it is safe to use in the Workers SSR
 * runtime. A positive website result recommends origin-first, but callers must
 * still provision the returned separate upstream hostname before activating it.
 */
export async function detectCustomDomain(hostname: string): Promise<DomainDetection> {
  const normalized = normalizeHostname(hostname);
  if (!normalized) return emptyDetection(hostname, { status: "unsafe", observations: [] });

  const dns = await inspectDns(normalized);
  if (dns.status !== "resolved") return emptyDetection(normalized, dns);

  return { hostname: normalized, dns, ...(await inspectHttps(normalized)) };
}
