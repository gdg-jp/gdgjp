import type { AuthUser, UserChapter } from "@gdgjp/gdg-lib";
import { parse } from "tldts";
import type { DomainDetection } from "~/lib/domain-detection";
import { type FeatureFailure, featureFailure } from "../shared/errors";
import { manageableChapterIds } from "./domain-policy";
import {
  type DomainProvider,
  DomainProviderHttpError,
  type ProviderDomainState,
} from "./domain-provider";
import {
  type Domain,
  createPendingDomain,
  getDomainById,
  listDomainsForChapters,
  updateDomainProviderState,
} from "./domain.repository";

export const VERCEL_HOBBY_DOMAIN_LIMIT = 50;

export type DomainServiceDependencies = {
  db: D1Database;
  provider: DomainProvider;
  detectCustomDomain: (hostname: string) => Promise<DomainDetection>;
};

export function normalizeApex(value: string): string | null {
  const raw = value.trim().toLowerCase().replace(/\.$/, "");
  try {
    const hostname = new URL(`https://${raw}`).hostname;
    const result = parse(hostname, { allowPrivateDomains: false });
    return result.isIcann && result.domain === hostname ? hostname : null;
  } catch {
    return null;
  }
}

async function upstreamReadiness(
  deps: DomainServiceDependencies,
  domain: Pick<Domain, "mode" | "upstreamOrigin">,
): Promise<{ ready: boolean; error: string | null }> {
  if (domain.mode === "short-only") return { ready: true, error: null };
  if (!domain.upstreamOrigin) return { ready: false, error: "The upstream origin is missing." };
  const hostname = new URL(domain.upstreamOrigin).hostname;
  const detection = await deps.detectCustomDomain(hostname);
  return detection.existingSite
    ? { ready: true, error: null }
    : {
        ready: false,
        error: `Connect ${hostname} to your existing website before switching the apex DNS.`,
      };
}

async function persistProviderState(
  deps: DomainServiceDependencies,
  domain: Domain,
  state: ProviderDomainState,
): Promise<Domain | null> {
  const upstream = await upstreamReadiness(deps, domain);
  return updateDomainProviderState(deps.db, domain.id, {
    status: state.verified && state.configured && upstream.ready ? "active" : "verifying",
    providerDomainId: state.providerDomainId,
    verificationRecords: state.records,
    providerError: upstream.error ?? state.error,
  });
}

export async function syncDomain(
  deps: DomainServiceDependencies,
  domainId: number,
): Promise<{ ok: true; domain: Domain } | { ok: false; domain: Domain; error: string }> {
  const domain = await getDomainById(deps.db, domainId);
  if (!domain) throw new Error(`Domain ${domainId} not found`);
  if (domain.kind !== "custom" || domain.deletedAt !== null) {
    return { ok: true, domain };
  }
  try {
    let state: ProviderDomainState;
    try {
      state = await deps.provider.check(domain.hostname);
    } catch (error) {
      // A previous attempt can fail before the Vercel domain is created. Once
      // provisioning configuration is fixed, retrying should create it.
      if (!(error instanceof DomainProviderHttpError) || error.status !== 404) throw error;
      state = await deps.provider.create(domain.hostname);
    }
    if (!state.verified) {
      try {
        state = await deps.provider.verify(domain.hostname);
      } catch (error) {
        if (!(error instanceof DomainProviderHttpError) || error.status !== 400) throw error;
        state = await deps.provider.check(domain.hostname);
      }
    }
    const updated = await persistProviderState(deps, domain, state);
    return { ok: true, domain: updated ?? domain };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Vercel synchronization failed";
    const updated = await updateDomainProviderState(deps.db, domain.id, {
      status: "error",
      providerError: message,
    });
    return { ok: false, domain: updated ?? domain, error: message };
  }
}

export async function registerDomain(
  deps: DomainServiceDependencies,
  actor: { user: AuthUser; chapters: UserChapter[] },
  input: { hostname: string; chapterId: number },
): Promise<{ ok: true; domain: Domain } | FeatureFailure> {
  const manageableIds = manageableChapterIds(actor.user, actor.chapters);
  if (!Number.isInteger(input.chapterId) || !manageableIds.includes(input.chapterId)) {
    return featureFailure("forbidden", "You cannot manage domains for that chapter.");
  }
  const hostname = normalizeApex(input.hostname);
  if (!hostname || hostname === "gdgs.jp") {
    return featureFailure("invalid_input", "Enter a registrable apex domain such as gdg-tokyo.jp.");
  }
  const inspection = await deps.detectCustomDomain(hostname);
  if (inspection.dns.status === "unsafe" || inspection.https.status === "unsafe-redirect") {
    return featureFailure(
      "invalid_input",
      "This domain resolves to an unsafe or private destination.",
    );
  }
  const mode = inspection.mode;
  const upstreamOrigin = inspection.suggestedUpstreamOrigin;
  const existing = await listDomainsForChapters(deps.db, manageableIds, false);
  if (existing.length >= VERCEL_HOBBY_DOMAIN_LIMIT) {
    return featureFailure(
      "invalid_input",
      "The Vercel Hobby project domain limit has been reached.",
    );
  }

  let domain: Domain;
  try {
    domain = await createPendingDomain(deps.db, {
      hostname,
      mode,
      upstreamOrigin,
      ownerChapterId: input.chapterId,
      createdByUserId: actor.user.id,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      return featureFailure("conflict", "That domain is already registered.");
    }
    throw error;
  }
  try {
    const state = await deps.provider.create(hostname);
    const updated = await persistProviderState(deps, domain, state);
    return { ok: true, domain: updated ?? domain };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Vercel provisioning failed";
    const updated = await updateDomainProviderState(deps.db, domain.id, {
      status: "error",
      providerError: message,
    });
    return { ok: true, domain: updated ?? domain };
  }
}
