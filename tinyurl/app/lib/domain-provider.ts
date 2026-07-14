import type { DnsRecord } from "./domains";

export type ProviderDomainState = {
  providerDomainId: string | null;
  verified: boolean;
  configured: boolean;
  records: DnsRecord[];
  error: string | null;
};

export interface DomainProvider {
  create(hostname: string): Promise<ProviderDomainState>;
  check(hostname: string): Promise<ProviderDomainState>;
  verify(hostname: string): Promise<ProviderDomainState>;
  remove(hostname: string): Promise<void>;
}

export class DomainProviderHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DomainProviderHttpError";
  }
}

type VercelVerification = {
  type?: string;
  domain?: string;
  value?: string;
  reason?: string;
};

type VercelDomain = {
  name?: string;
  verified?: boolean;
  verification?: VercelVerification[];
  error?: { message?: string } | string;
};

type VercelConfig = {
  misconfigured?: boolean;
  recommendedIPv4?: Array<{ rank?: number; value?: string | string[] }>;
  recommendedCNAME?: Array<{ rank?: number; value?: string | string[] }>;
};

function valuesOf(value: string | string[] | undefined): string[] {
  return typeof value === "string" ? [value] : (value ?? []);
}

function recordsFrom(domain: VercelDomain, config?: VercelConfig): DnsRecord[] {
  const records: DnsRecord[] = [];
  for (const item of domain.verification ?? []) {
    const type = item.type?.toUpperCase();
    if (
      !item.domain ||
      !item.value ||
      (type !== "A" && type !== "AAAA" && type !== "CNAME" && type !== "TXT" && type !== "CAA")
    ) {
      continue;
    }
    records.push({
      type,
      name: item.domain,
      value: item.value,
      reason: item.reason,
      purpose: "ownership",
      status: domain.verified ? "verified" : "pending",
    });
  }
  for (const item of config?.recommendedIPv4 ?? []) {
    for (const value of item.rank === 1 ? valuesOf(item.value) : []) {
      records.push({
        type: "A",
        name: "@",
        value,
        reason: "Vercel apex routing",
        purpose: "routing",
        status: config?.misconfigured === false ? "verified" : "pending",
        alternativeGroup: "apex-routing",
      });
    }
  }
  for (const item of config?.recommendedCNAME ?? []) {
    for (const value of item.rank === 1 ? valuesOf(item.value) : []) {
      records.push({
        type: "CNAME",
        name: "@",
        value,
        reason: "Vercel routing",
        purpose: "routing",
        status: config?.misconfigured === false ? "verified" : "pending",
        alternativeGroup: "apex-routing",
      });
    }
  }
  return records.filter(
    (record, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.type === record.type &&
          candidate.name === record.name &&
          candidate.value === record.value,
      ) === index,
  );
}

export class VercelDomainProvider implements DomainProvider {
  constructor(
    private readonly token: string,
    private readonly projectId: string,
    private readonly teamId?: string,
  ) {}

  private url(path: string): string {
    const url = new URL(path, "https://api.vercel.com");
    if (this.teamId) url.searchParams.set("teamId", this.teamId);
    return url.toString();
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(this.url(path), {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as VercelDomain | null;
      const detail =
        typeof body?.error === "string" ? body.error : body?.error?.message || response.statusText;
      throw new DomainProviderHttpError(
        response.status,
        `Vercel API ${response.status}: ${detail}`,
      );
    }
    if (response.status === 204) return undefined as T;
    return response.json<T>();
  }

  private async state(domain: VercelDomain): Promise<ProviderDomainState> {
    const config = await this.request<VercelConfig>(
      `/v6/domains/${encodeURIComponent(domain.name ?? "")}/config?projectIdOrName=${encodeURIComponent(this.projectId)}`,
    );
    return {
      providerDomainId: domain.name ?? null,
      verified: domain.verified === true,
      configured: config.misconfigured === false,
      records: recordsFrom(domain, config),
      error: null,
    };
  }

  async create(hostname: string): Promise<ProviderDomainState> {
    const domain = await this.request<VercelDomain>(
      `/v10/projects/${encodeURIComponent(this.projectId)}/domains`,
      { method: "POST", body: JSON.stringify({ name: hostname }) },
    );
    return this.state({ ...domain, name: domain.name ?? hostname });
  }

  async check(hostname: string): Promise<ProviderDomainState> {
    const domain = await this.request<VercelDomain>(
      `/v9/projects/${encodeURIComponent(this.projectId)}/domains/${encodeURIComponent(hostname)}`,
    );
    return this.state({ ...domain, name: domain.name ?? hostname });
  }

  async verify(hostname: string): Promise<ProviderDomainState> {
    const domain = await this.request<VercelDomain>(
      `/v9/projects/${encodeURIComponent(this.projectId)}/domains/${encodeURIComponent(hostname)}/verify`,
      { method: "POST" },
    );
    return this.state({ ...domain, name: domain.name ?? hostname });
  }

  async remove(hostname: string): Promise<void> {
    await this.request<void>(
      `/v9/projects/${encodeURIComponent(this.projectId)}/domains/${encodeURIComponent(hostname)}`,
      { method: "DELETE" },
    );
  }
}

export function createDomainProvider(env: Env): DomainProvider {
  if (!env.VERCEL_TOKEN || !env.VERCEL_PROJECT_ID) {
    throw new Error("Vercel domain provisioning is not configured");
  }
  return new VercelDomainProvider(env.VERCEL_TOKEN, env.VERCEL_PROJECT_ID, env.VERCEL_TEAM_ID);
}
