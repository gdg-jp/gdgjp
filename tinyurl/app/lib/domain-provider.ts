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
  recommendedIPv4?: Array<{ rank?: number; value?: string }>;
  recommendedCNAME?: Array<{ rank?: number; value?: string }>;
};

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
    records.push({ type, name: item.domain, value: item.value, reason: item.reason });
  }
  for (const item of config?.recommendedIPv4 ?? []) {
    if (item.rank === 1 && item.value) {
      records.push({ type: "A", name: "@", value: item.value, reason: "Vercel apex routing" });
    }
  }
  for (const item of config?.recommendedCNAME ?? []) {
    if (item.rank === 1 && item.value) {
      records.push({
        type: "CNAME",
        name: "@",
        value: item.value,
        reason: "Vercel routing",
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
      throw new Error(`Vercel API ${response.status}: ${detail}`);
    }
    if (response.status === 204) return undefined as T;
    return response.json<T>();
  }

  private async state(domain: VercelDomain): Promise<ProviderDomainState> {
    const config = await this.request<VercelConfig>(
      `/v6/domains/${encodeURIComponent(domain.name ?? "")}/config?projectId=${encodeURIComponent(this.projectId)}`,
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
