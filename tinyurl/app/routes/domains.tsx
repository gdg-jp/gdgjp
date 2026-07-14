import {
  CheckCircle2,
  CircleAlert,
  Copy,
  Globe2,
  LoaderCircle,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Form, useFetcher, useRevalidator } from "react-router";
import { parse } from "tldts";
import { DashboardShell } from "~/components/dashboard-shell";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { requireUserWithChapter } from "~/lib/auth-redirect";
import {
  DomainProviderHttpError,
  type ProviderDomainState,
  createDomainProvider,
} from "~/lib/domain-provider";
import {
  type Domain,
  type DomainMode,
  countLinksForDomain,
  createPendingDomain,
  getDomainById,
  listDomainsForChapters,
  softDeleteDomain,
  updateDomainProviderState,
} from "~/lib/domains";
import { validatePublicHttpUrl } from "~/lib/ogp";
import { canManageChapterDomains } from "~/lib/permissions";
import type { Route } from "./+types/domains";

const VERCEL_HOBBY_DOMAIN_LIMIT = 50;

export function meta() {
  return [{ title: "Domains — GDG Japan Links" }];
}

function featureEnabled(env: Env): boolean {
  return String(env.DOMAINS_ENABLED) === "true";
}

function manageableChapterIds(
  user: Awaited<ReturnType<typeof requireUserWithChapter>>["user"],
  chapters: Awaited<ReturnType<typeof requireUserWithChapter>>["chapters"],
): number[] {
  return chapters
    .filter((chapter) => canManageChapterDomains(user, chapter))
    .map((chapter) => chapter.chapterId);
}

function normalizeApex(value: string): string | null {
  const raw = value.trim().toLowerCase().replace(/\.$/, "");
  try {
    const hostname = new URL(`https://${raw}`).hostname;
    const result = parse(hostname, { allowPrivateDomains: false });
    return result.isIcann && result.domain === hostname ? hostname : null;
  } catch {
    return null;
  }
}

async function normalizeOrigin(value: string, publicHostname: string): Promise<string | null> {
  const validation = await validatePublicHttpUrl(value.trim());
  if (!validation.ok) return null;
  const url = validation.url;
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    return null;
  }
  const hostname = url.hostname.toLowerCase();
  if (
    hostname === publicHostname ||
    hostname === "gdgs.jp" ||
    hostname.endsWith(".gdgs.jp") ||
    hostname === "vercel.app" ||
    hostname.endsWith(".vercel.app")
  ) {
    return null;
  }
  return url.origin;
}

async function syncDomain(env: Env, domain: Domain): Promise<void> {
  if (domain.kind !== "custom" || domain.deletedAt !== null) return;
  const provider = createDomainProvider(env);
  try {
    let state: ProviderDomainState;
    try {
      state = await provider.check(domain.hostname);
    } catch (error) {
      // A previous attempt can fail before the Vercel domain is created. Once
      // provisioning configuration is fixed, retrying should create it.
      if (!(error instanceof DomainProviderHttpError) || error.status !== 404) throw error;
      state = await provider.create(domain.hostname);
    }
    if (!state.verified) state = await provider.verify(domain.hostname);
    await updateDomainProviderState(env.DB, domain.id, {
      status: state.verified && state.configured ? "active" : "verifying",
      providerDomainId: state.providerDomainId,
      verificationRecords: state.records,
      providerError: state.error,
    });
  } catch (error) {
    await updateDomainProviderState(env.DB, domain.id, {
      status: "error",
      providerError: error instanceof Error ? error.message : "Vercel synchronization failed",
    });
  }
}

export async function loader(args: Route.LoaderArgs) {
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

export async function action(args: Route.ActionArgs) {
  const env = args.context.cloudflare.env;
  if (!featureEnabled(env)) throw new Response("Not Found", { status: 404 });
  const { user, chapters } = await requireUserWithChapter(env, args.request);
  const manageableIds = manageableChapterIds(user, chapters);
  if (manageableIds.length === 0) throw new Response("Forbidden", { status: 403 });
  const form = await args.request.formData();
  const intent = String(form.get("intent") ?? "create");

  if (intent === "syncAll") {
    const domains = await listDomainsForChapters(env.DB, manageableIds, false);
    await Promise.all(
      domains
        .filter((domain) => domain.status !== "active")
        .map((domain) => syncDomain(env, domain)),
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
      await syncDomain(env, domain);
      return { ok: true };
    }
    if ((await countLinksForDomain(env.DB, domain.id)) > 0) {
      return { error: "This domain still has active links and cannot be removed." };
    }
    try {
      await createDomainProvider(env).remove(domain.hostname);
      await softDeleteDomain(env.DB, domain.id);
      return { ok: true };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Domain removal failed" };
    }
  }

  const chapterId = Number(form.get("chapterId"));
  if (!Number.isInteger(chapterId) || !manageableIds.includes(chapterId)) {
    throw new Response("Forbidden", { status: 403 });
  }
  const hostname = normalizeApex(String(form.get("hostname") ?? ""));
  if (!hostname || hostname === "gdgs.jp") {
    return { error: "Enter a registrable apex domain such as gdg-tokyo.jp." };
  }
  const mode = String(form.get("mode")) as DomainMode;
  if (mode !== "short-only" && mode !== "origin-first") return { error: "Invalid mode." };
  const upstreamOrigin =
    mode === "origin-first"
      ? await normalizeOrigin(String(form.get("upstreamOrigin") ?? ""), hostname)
      : null;
  if (mode === "origin-first" && !upstreamOrigin) {
    return { error: "Origin must be a public HTTPS origin on a separate hostname." };
  }
  const existing = await listDomainsForChapters(env.DB, manageableIds, false);
  if (existing.length >= VERCEL_HOBBY_DOMAIN_LIMIT) {
    return { error: "The Vercel Hobby project domain limit has been reached." };
  }

  let domain: Domain;
  try {
    domain = await createPendingDomain(env.DB, {
      hostname,
      mode,
      upstreamOrigin,
      ownerChapterId: chapterId,
      createdByUserId: user.id,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      return { error: "That domain is already registered." };
    }
    throw error;
  }
  try {
    const state = await createDomainProvider(env).create(hostname);
    await updateDomainProviderState(env.DB, domain.id, {
      status: state.verified && state.configured ? "active" : "verifying",
      providerDomainId: state.providerDomainId,
      verificationRecords: state.records,
    });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Vercel provisioning failed";
    await updateDomainProviderState(env.DB, domain.id, { status: "error", providerError: message });
    return { error: message };
  }
}

function DomainStatusIcon({ domain }: { domain: Domain }) {
  if (domain.status === "active") return <CheckCircle2 className="size-4 text-green-600" />;
  if (domain.status === "error") return <CircleAlert className="size-4 text-destructive" />;
  return <LoaderCircle className="size-4 animate-spin text-muted-foreground" />;
}

export default function Domains({ loaderData, actionData }: Route.ComponentProps) {
  const revalidator = useRevalidator();
  const syncer = useFetcher();
  const [mode, setMode] = useState<DomainMode>("short-only");
  const pending = loaderData.domains.some(
    (domain) =>
      domain.kind === "custom" && domain.status !== "active" && domain.status !== "deleted",
  );
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => {
      if (syncer.state === "idle") syncer.submit({ intent: "syncAll" }, { method: "post" });
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [pending, syncer]);
  useEffect(() => {
    if (syncer.state === "idle" && syncer.data) revalidator.revalidate();
  }, [syncer.state, syncer.data, revalidator]);

  const organizers = loaderData.chapters.filter((chapter) =>
    loaderData.manageableIds.includes(chapter.chapterId),
  );
  return (
    <DashboardShell user={loaderData.user}>
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Globe2 className="size-6" /> Domains
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {loaderData.remainingDomains} of {VERCEL_HOBBY_DOMAIN_LIMIT} Vercel project slots
            remain.
          </p>
        </div>

        {actionData && "error" in actionData ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {actionData.error}
          </p>
        ) : null}

        {organizers.length > 0 ? (
          <Form method="post" className="grid gap-4 rounded-xl border bg-card p-5 md:grid-cols-2">
            <input type="hidden" name="intent" value="create" />
            <div className="space-y-2">
              <Label htmlFor="domain-hostname">Apex domain</Label>
              <Input id="domain-hostname" name="hostname" placeholder="gdg-tokyo.jp" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="domain-chapter">Chapter</Label>
              <Select name="chapterId" defaultValue={String(organizers[0].chapterId)}>
                <SelectTrigger id="domain-chapter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {organizers.map((chapter) => (
                    <SelectItem key={chapter.chapterId} value={String(chapter.chapterId)}>
                      {chapter.chapterSlug}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="domain-mode">Delivery mode</Label>
              <input type="hidden" name="mode" value={mode} />
              <Select value={mode} onValueChange={(value) => setMode(value as DomainMode)}>
                <SelectTrigger id="domain-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="short-only">Short links only</SelectItem>
                  <SelectItem value="origin-first">Existing origin first</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {mode === "origin-first" ? (
              <div className="space-y-2">
                <Label htmlFor="domain-origin">Upstream origin</Label>
                <Input
                  id="domain-origin"
                  name="upstreamOrigin"
                  type="url"
                  placeholder="https://origin.gdg-tokyo.jp"
                  required
                  aria-describedby="domain-origin-help"
                />
                <p id="domain-origin-help" className="text-xs text-muted-foreground">
                  Required. Use a public HTTPS hostname other than this custom domain. Requests that
                  are not short links are served from this origin.
                </p>
              </div>
            ) : (
              <p className="self-end text-xs text-muted-foreground">
                This domain will serve short links only. No upstream origin is required.
              </p>
            )}
            <div className="md:col-span-2">
              <Button type="submit" disabled={loaderData.remainingDomains === 0}>
                <Plus className="size-4" /> Add domain
              </Button>
            </div>
          </Form>
        ) : null}

        <div className="space-y-3">
          {loaderData.domains.map((domain) => (
            <section key={domain.id} className="rounded-xl border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 font-medium">
                    <DomainStatusIcon domain={domain} /> {domain.hostname}
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {domain.kind} · {domain.mode} · {domain.status}
                    {domain.upstreamOrigin ? ` · ${domain.upstreamOrigin}` : ""}
                  </p>
                </div>
                {domain.kind === "custom" ? (
                  <div className="flex gap-2">
                    <Form method="post">
                      <input type="hidden" name="intent" value="sync" />
                      <input type="hidden" name="domainId" value={domain.id} />
                      <Button type="submit" variant="outline" size="sm">
                        <RefreshCw className="size-4" /> Sync
                      </Button>
                    </Form>
                    <Form method="post">
                      <input type="hidden" name="intent" value="delete" />
                      <input type="hidden" name="domainId" value={domain.id} />
                      <Button type="submit" variant="destructive" size="sm">
                        <Trash2 className="size-4" /> Remove
                      </Button>
                    </Form>
                  </div>
                ) : null}
              </div>
              {domain.verificationRecords.length > 0 ? (
                <div className="mt-4 overflow-x-auto rounded-md border">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-muted/60 text-xs text-muted-foreground">
                      <tr>
                        <th className="p-2">Type</th>
                        <th className="p-2">Name</th>
                        <th className="p-2">Value</th>
                        <th className="p-2">Copy</th>
                      </tr>
                    </thead>
                    <tbody>
                      {domain.verificationRecords.map((record) => (
                        <tr
                          key={`${record.type}-${record.name}-${record.value}`}
                          className="border-t"
                        >
                          <td className="p-2 font-mono">{record.type}</td>
                          <td className="p-2 font-mono">{record.name}</td>
                          <td className="max-w-md break-all p-2 font-mono text-xs">
                            {record.value}
                          </td>
                          <td className="p-2">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => navigator.clipboard.writeText(record.value)}
                              aria-label="Copy DNS value"
                            >
                              <Copy className="size-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {domain.providerError ? (
                <p className="mt-3 text-sm text-destructive">{domain.providerError}</p>
              ) : null}
            </section>
          ))}
        </div>
      </div>
    </DashboardShell>
  );
}
