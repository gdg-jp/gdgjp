import { requireUserWithChapter } from "~/features/auth/auth-redirect";
import {
  type DomainServiceDependencies,
  VERCEL_HOBBY_DOMAIN_LIMIT,
  countLinksForDomain,
  createDomainProvider,
  getDomainById,
  listDomainsForChapters,
  manageableChapterIds,
  normalizeApex,
  registerDomain,
  softDeleteDomain,
  syncDomain,
} from "~/features/domains";
import { detectCustomDomain } from "~/features/domains/domain-detection";
import type { PageRequestArgs } from "~/http/request";

export function featureEnabled(env: Env): boolean {
  return String(env.DOMAINS_ENABLED) === "true";
}

export async function loader(args: PageRequestArgs) {
  const env = args.context.cloudflare.env;
  if (!featureEnabled(env)) throw new Response("Not Found", { status: 404 });
  const { user, chapter, chapters } = await requireUserWithChapter(env, args.request);
  const manageableIds = manageableChapterIds(user, chapters);
  const visibleIds = chapters.map((item) => item.chapterId);
  const domains = await listDomainsForChapters(env.DB, visibleIds);
  return {
    user,
    chapter,
    chapters,
    domains,
    manageableIds,
    remainingDomains: Math.max(
      0,
      VERCEL_HOBBY_DOMAIN_LIMIT - domains.filter((domain) => domain.kind === "custom").length,
    ),
  };
}

export async function action(args: PageRequestArgs) {
  const env = args.context.cloudflare.env;
  if (!featureEnabled(env)) throw new Response("Not Found", { status: 404 });
  const { user, chapters } = await requireUserWithChapter(env, args.request);
  const manageableIds = manageableChapterIds(user, chapters);
  if (manageableIds.length === 0) throw new Response("Forbidden", { status: 403 });
  const form = await args.request.formData();
  const intent = String(form.get("intent") ?? "create");

  if (intent === "inspect") {
    const hostname = normalizeApex(String(form.get("hostname") ?? ""));
    if (!hostname || hostname === "gdgs.jp") {
      return { error: "Enter an apex domain such as gdg-tokyo.jp." };
    }
    return { inspection: await detectCustomDomain(hostname) };
  }

  const deps: DomainServiceDependencies = {
    db: env.DB,
    provider: createDomainProvider(env),
    detectCustomDomain,
  };

  if (intent === "syncAll") {
    const domains = await listDomainsForChapters(env.DB, manageableIds, false);
    await Promise.all(
      domains
        .filter((domain) => domain.status !== "active")
        .map((domain) => syncDomain(deps, domain.id)),
    );
    return { ok: true };
  }

  if (intent === "sync" || intent === "delete") {
    const id = Number(form.get("domainId"));
    const domain = Number.isInteger(id) ? await getDomainById(env.DB, id) : null;
    if (
      !domain ||
      domain.ownerChapterId === null ||
      !manageableIds.includes(domain.ownerChapterId)
    ) {
      throw new Response("Forbidden", { status: 403 });
    }
    if (intent === "sync") {
      await syncDomain(deps, domain.id);
      return { ok: true };
    }
    if ((await countLinksForDomain(env.DB, domain.id)) > 0) {
      return { error: "This domain still has active links and cannot be removed." };
    }
    try {
      await deps.provider.remove(domain.hostname);
      await softDeleteDomain(env.DB, domain.id);
      return { ok: true };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Domain removal failed" };
    }
  }

  const chapterId = Number(form.get("chapterId"));
  const result = await registerDomain(
    deps,
    { user, chapters },
    { hostname: String(form.get("hostname") ?? ""), chapterId },
  );
  if (!result.ok) {
    if (result.code === "forbidden") throw new Response("Forbidden", { status: 403 });
    return { error: result.error };
  }
  if (result.domain.status === "error") {
    return {
      ok: true,
      domainId: result.domain.id,
      provisioningWarning: result.domain.providerError ?? "Vercel provisioning failed",
    };
  }
  return { ok: true, domainId: result.domain.id };
}

export type DomainsPageData = Awaited<ReturnType<typeof loader>>;
export type DomainsPageAction = Awaited<ReturnType<typeof action>>;
