import {
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CloudOff,
  Copy,
  EllipsisVertical,
  ExternalLink,
  Globe2,
  LoaderCircle,
  Plus,
  RefreshCw,
  Server,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Form, useFetcher, useRevalidator } from "react-router";
import { parse } from "tldts";
import { DashboardPage, DashboardPageHeader } from "~/components/dashboard-page";
import { DashboardShell } from "~/components/dashboard-shell";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
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
import { type DomainDetection, detectCustomDomain } from "~/lib/domain-detection";
import {
  DomainProviderHttpError,
  type ProviderDomainState,
  createDomainProvider,
} from "~/lib/domain-provider";
import {
  type Domain,
  countLinksForDomain,
  createPendingDomain,
  getDomainById,
  listDomainsForChapters,
  softDeleteDomain,
  updateDomainProviderState,
} from "~/lib/domains";
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

async function upstreamReadiness(domain: Pick<Domain, "mode" | "upstreamOrigin">) {
  if (domain.mode === "short-only") return { ready: true, error: null };
  if (!domain.upstreamOrigin) return { ready: false, error: "The upstream origin is missing." };
  const hostname = new URL(domain.upstreamOrigin).hostname;
  const detection = await detectCustomDomain(hostname);
  return detection.existingSite
    ? { ready: true, error: null }
    : {
        ready: false,
        error: `Connect ${hostname} to your existing website before switching the apex DNS.`,
      };
}

async function persistProviderState(env: Env, domain: Domain, state: ProviderDomainState) {
  const upstream = await upstreamReadiness(domain);
  return updateDomainProviderState(env.DB, domain.id, {
    status: state.verified && state.configured && upstream.ready ? "active" : "verifying",
    providerDomainId: state.providerDomainId,
    verificationRecords: state.records,
    providerError: upstream.error ?? state.error,
  });
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
    if (!state.verified) {
      try {
        state = await provider.verify(domain.hostname);
      } catch (error) {
        if (!(error instanceof DomainProviderHttpError) || error.status !== 400) throw error;
        state = await provider.check(domain.hostname);
      }
    }
    await persistProviderState(env, domain, state);
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

  if (intent === "inspect") {
    const hostname = normalizeApex(String(form.get("hostname") ?? ""));
    if (!hostname || hostname === "gdgs.jp") {
      return { error: "Enter an apex domain such as gdg-tokyo.jp." };
    }
    return { inspection: await detectCustomDomain(hostname) };
  }

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
  const inspection = await detectCustomDomain(hostname);
  if (inspection.dns.status === "unsafe" || inspection.https.status === "unsafe-redirect") {
    return { error: "This domain resolves to an unsafe or private destination." };
  }
  const mode = inspection.mode;
  const upstreamOrigin = inspection.suggestedUpstreamOrigin;
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
    await persistProviderState(env, domain, state);
    return { ok: true, domainId: domain.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Vercel provisioning failed";
    await updateDomainProviderState(env.DB, domain.id, { status: "error", providerError: message });
    return { ok: true, domainId: domain.id, provisioningWarning: message };
  }
}

type Organizer = { chapterId: number; chapterSlug: string };

function ConnectDomainDialog({
  open,
  onOpenChange,
  organizers,
  disabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizers: Organizer[];
  disabled: boolean;
}) {
  const inspector = useFetcher<typeof action>();
  const creator = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const [hostname, setHostname] = useState("");
  const [requestedHostname, setRequestedHostname] = useState("");
  const [chapterId, setChapterId] = useState(String(organizers[0]?.chapterId ?? ""));
  const inspectSubmit = inspector.submit;

  useEffect(() => {
    if (!open || hostname.trim().length < 4) return;
    const timer = window.setTimeout(() => {
      setRequestedHostname(hostname.trim().toLowerCase().replace(/\.$/, ""));
      inspectSubmit({ intent: "inspect", hostname }, { method: "post" });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [hostname, inspectSubmit, open]);

  useEffect(() => {
    if (creator.state !== "idle" || !creator.data || !("ok" in creator.data)) return;
    onOpenChange(false);
    setHostname("");
    revalidator.revalidate();
  }, [creator.data, creator.state, onOpenChange, revalidator]);

  const inspection: DomainDetection | null =
    inspector.data && "inspection" in inspector.data ? (inspector.data.inspection ?? null) : null;
  const currentHostname = hostname.trim().toLowerCase().replace(/\.$/, "");
  const displayedInspection = inspection?.hostname === currentHostname ? inspection : null;
  const inspectError =
    requestedHostname === currentHostname && inspector.data && "error" in inspector.data
      ? String(inspector.data.error)
      : null;
  const createError = creator.data && "error" in creator.data ? String(creator.data.error) : null;
  const checking = inspector.state !== "idle";
  const inspectionReady =
    displayedInspection !== null &&
    displayedInspection.dns.status !== "unsafe" &&
    displayedInspection.dns.status !== "error" &&
    displayedInspection.https.status !== "unsafe-redirect";
  const canCreate = inspectionReady && !disabled;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden sm:max-w-2xl">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle className="text-xl">Add Domain</DialogTitle>
          <DialogDescription>
            We check the current DNS and website before choosing the safest delivery mode.
          </DialogDescription>
        </DialogHeader>
        <creator.Form method="post">
          <input type="hidden" name="intent" value="create" />
          <input type="hidden" name="chapterId" value={chapterId} />
          <div className="space-y-5 px-6 py-6">
            <div className="space-y-2">
              <Label htmlFor="connect-domain">Your domain</Label>
              <Input
                id="connect-domain"
                name="hostname"
                value={hostname}
                onChange={(event) => setHostname(event.target.value)}
                placeholder="gdg-tokyo.jp"
                autoComplete="off"
                aria-describedby="domain-check-result"
                required
                autoFocus
              />
              <div id="domain-check-result" aria-live="polite" className="min-h-6 text-sm">
                {checking ? (
                  <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <LoaderCircle className="size-4 animate-spin" /> Checking DNS and HTTPS…
                  </span>
                ) : inspectError ? (
                  <span className="text-destructive">{inspectError}</span>
                ) : displayedInspection && inspectionReady ? (
                  <span className="inline-flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="size-4" /> {displayedInspection.hostname} is ready to
                    connect.
                  </span>
                ) : displayedInspection ? (
                  <span className="inline-flex items-center gap-2 text-destructive">
                    <CircleAlert className="size-4" /> We couldn’t safely verify this domain. Check
                    its DNS and try again.
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    Enter the apex domain without a path.
                  </span>
                )}
              </div>
            </div>

            {organizers.length > 1 ? (
              <div className="space-y-2">
                <Label htmlFor="connect-domain-chapter">Chapter</Label>
                <Select value={chapterId} onValueChange={setChapterId}>
                  <SelectTrigger id="connect-domain-chapter">
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
            ) : null}

            {displayedInspection && inspectionReady ? (
              <div className="rounded-xl border bg-muted/35 p-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-full border bg-background p-2">
                    {displayedInspection.existingSite ? (
                      <Server className="size-4" />
                    ) : (
                      <Globe2 className="size-4" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium">
                      {displayedInspection.existingSite
                        ? "Existing website detected"
                        : "Short-link-only domain"}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {displayedInspection.existingSite
                        ? `We’ll preserve the site first and use ${displayedInspection.suggestedUpstreamOrigin} as its private origin.`
                        : "No current HTTPS website was found, so every path will be handled as a short link."}
                    </p>
                    {displayedInspection.existingSite ? (
                      <p className="mt-3 border-t pt-3 text-sm">
                        After adding the domain, connect{" "}
                        <code>origin.{displayedInspection.hostname}</code> to the existing hosting
                        project. The domain stays Invalid until that origin and the gateway DNS
                        records are ready.
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            {createError ? (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {createError}
              </p>
            ) : null}
          </div>
          <div className="border-t bg-muted/20 px-6 py-5">
            <Button
              type="submit"
              className="h-11 w-full bg-foreground text-background hover:bg-foreground/90"
              disabled={!canCreate || creator.state !== "idle"}
            >
              {creator.state !== "idle" ? <LoaderCircle className="size-4 animate-spin" /> : null}
              Add domain
            </Button>
          </div>
        </creator.Form>
      </DialogContent>
    </Dialog>
  );
}

function StatusBadge({ domain }: { domain: Domain }) {
  if (domain.status === "active") {
    return (
      <Badge className="border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
        <CheckCircle2 /> Active
      </Badge>
    );
  }
  return (
    <Badge className="border-red-200 bg-red-100 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
      <CircleAlert /> Invalid
    </Badge>
  );
}

function ProgressItem({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      {done ? (
        <CheckCircle2 className="size-4 text-emerald-600" />
      ) : (
        <LoaderCircle className="size-4 text-amber-500" />
      )}
      <span className={done ? "text-foreground" : "text-muted-foreground"}>{children}</span>
    </li>
  );
}

function DomainActionsMenu({ domain }: { domain: Domain }) {
  const actionFetcher = useFetcher<typeof action>();
  const [removeOpen, setRemoveOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${domain.hostname}`}
            className="shrink-0"
          >
            <EllipsisVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {domain.kind === "custom" ? (
            <DropdownMenuItem
              onSelect={() =>
                actionFetcher.submit(
                  { intent: "sync", domainId: String(domain.id) },
                  { method: "post" },
                )
              }
            >
              <RefreshCw className="size-4" />
              Check DNS now
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => navigator.clipboard.writeText(domain.hostname)}>
            <Copy className="size-4" />
            Copy domain
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={`https://${domain.hostname}`} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-4" />
              Visit domain
            </a>
          </DropdownMenuItem>
          {domain.kind === "custom" ? (
            <DropdownMenuItem variant="destructive" onSelect={() => setRemoveOpen(true)}>
              <Trash2 className="size-4" />
              Remove domain…
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {domain.kind === "custom" ? (
        <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
          <AlertDialogContent>
            <Form method="post">
              <input type="hidden" name="intent" value="delete" />
              <input type="hidden" name="domainId" value={domain.id} />
              <AlertDialogHeader>
                <AlertDialogTitle>Remove {domain.hostname}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This disconnects the domain from the gateway. Domains with active links cannot be
                  removed.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="mt-5">
                <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
                <AlertDialogAction type="submit" variant="destructive">
                  Remove domain
                </AlertDialogAction>
              </AlertDialogFooter>
            </Form>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </>
  );
}

function DomainCard({ domain, chapterSlug }: { domain: Domain; chapterSlug?: string }) {
  const [expanded, setExpanded] = useState(domain.status !== "active");
  const active = domain.status === "active";
  const ownershipRecords = domain.verificationRecords.filter(
    (record) => record.purpose === "ownership" || record.type === "TXT",
  );
  const routingRecords = domain.verificationRecords.filter(
    (record) => record.purpose === "routing" || record.reason?.toLowerCase().includes("routing"),
  );
  const ownershipDone =
    active ||
    (ownershipRecords.length > 0 &&
      ownershipRecords.every((record) => record.status === "verified"));
  const routingDone = active || routingRecords.some((record) => record.status === "verified");
  const originPending = domain.providerError?.startsWith("Connect ") === true;
  const hasApexAAlternative = domain.verificationRecords.some(
    (record) => record.alternativeGroup === "apex-routing" && record.type === "A",
  );
  const displayedRecords = domain.verificationRecords.filter(
    (record) =>
      !(
        hasApexAAlternative &&
        record.alternativeGroup === "apex-routing" &&
        record.type === "CNAME"
      ),
  );

  if (domain.kind === "system") {
    return (
      <section className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-1 rounded-xl border bg-card px-3 py-3 shadow-xs sm:grid-cols-[auto_minmax(0,1fr)_minmax(7rem,0.45fr)_auto_auto] sm:gap-3 sm:px-4">
        <div className="grid size-10 shrink-0 place-items-center rounded-full border bg-background">
          <Globe2 className="size-4 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium">{domain.hostname}</h2>
          <p className="truncate text-xs text-muted-foreground">System short-link domain</p>
        </div>
        <div className="col-start-2 row-start-2 justify-self-start sm:col-start-3 sm:row-start-1 sm:justify-self-center">
          <StatusBadge domain={domain} />
        </div>
        <span
          aria-hidden="true"
          className="col-start-3 row-span-2 row-start-1 size-8 sm:col-start-4 sm:row-span-1"
        />
        <div className="col-start-4 row-span-2 row-start-1 sm:col-start-5 sm:row-span-1">
          <DomainActionsMenu domain={domain} />
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-xs transition-shadow hover:shadow-sm">
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-1 px-3 py-3 sm:grid-cols-[auto_minmax(0,1fr)_minmax(7rem,0.45fr)_auto_auto] sm:gap-3 sm:px-4">
        <div className="grid size-10 shrink-0 place-items-center rounded-full border bg-background">
          <Globe2 className="size-4 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium">{domain.hostname}</h2>
          <p className="truncate text-xs text-muted-foreground">
            {domain.mode === "origin-first"
              ? `Existing website via ${domain.upstreamOrigin}`
              : "Short links only"}
            {chapterSlug ? ` · ${chapterSlug}` : ""}
          </p>
        </div>
        <div className="col-start-2 row-start-2 justify-self-start sm:col-start-3 sm:row-start-1 sm:justify-self-center">
          <StatusBadge domain={domain} />
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={expanded ? "Hide DNS configuration" : "Show DNS configuration"}
          aria-expanded={expanded}
          aria-controls={`domain-setup-${domain.id}`}
          onClick={() => setExpanded((value) => !value)}
          className="col-start-3 row-span-2 row-start-1 shrink-0 sm:col-start-4 sm:row-span-1"
        >
          <ChevronDown className={`size-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </Button>
        <div className="col-start-4 row-span-2 row-start-1 sm:col-start-5 sm:row-span-1">
          <DomainActionsMenu domain={domain} />
        </div>
      </div>

      {expanded ? (
        <div id={`domain-setup-${domain.id}`} className="border-t px-4 py-5">
          <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
            <div>
              <h3 className="text-sm font-semibold">Connection progress</h3>
              <ol className="mt-3 space-y-3">
                <ProgressItem done>Domain saved</ProgressItem>
                <ProgressItem done={domain.providerDomainId !== null}>
                  Added to gateway
                </ProgressItem>
                <ProgressItem done={ownershipDone}>Ownership verified</ProgressItem>
                <ProgressItem done={routingDone}>Gateway DNS configured</ProgressItem>
                {domain.mode === "origin-first" ? (
                  <ProgressItem done={!originPending}>
                    Existing website origin connected
                  </ProgressItem>
                ) : null}
              </ol>
              {domain.checkedAt ? (
                <p className="mt-4 text-xs text-muted-foreground">
                  Last checked {new Date(domain.checkedAt * 1000).toLocaleString()}
                </p>
              ) : null}
            </div>

            <div className="min-w-0">
              <div>
                <h3 className="text-sm font-semibold">DNS records</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Add the pending ownership and routing records at your DNS provider. When an A
                  record is shown for the apex, do not add a CNAME for the same name.
                </p>
              </div>

              <div className="mt-4 flex gap-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
                <CloudOff className="mt-0.5 size-4 shrink-0" />
                <div>
                  <p className="font-medium">Using Cloudflare DNS?</p>
                  <p className="mt-1 text-sky-800 dark:text-sky-200">
                    Keep Proxy status OFF for the A, AAAA, or CNAME routing record. It must show as
                    DNS only with a gray cloud. Cloudflare does not allow an apex CNAME alongside an
                    existing A/AAAA record, so use the displayed A record instead of adding both.
                  </p>
                </div>
              </div>

              {domain.mode === "origin-first" && domain.upstreamOrigin ? (
                <div className="mt-4 rounded-lg border bg-muted/30 p-3 text-sm">
                  <p className="font-medium">Preserve the existing website first</p>
                  <p className="mt-1 text-muted-foreground">
                    Add <code>{new URL(domain.upstreamOrigin).hostname}</code> to the existing
                    hosting project and follow that provider’s DNS instructions. It must serve the
                    current site over HTTPS without redirecting back to {domain.hostname}.
                  </p>
                </div>
              ) : null}

              {displayedRecords.length > 0 ? (
                <div className="mt-4 overflow-x-auto rounded-lg border">
                  <table className="w-full min-w-[620px] text-left text-sm">
                    <caption className="sr-only">
                      Required DNS records for {domain.hostname}
                    </caption>
                    <thead className="bg-muted/50 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Type</th>
                        <th className="px-3 py-2 font-medium">Name</th>
                        <th className="px-3 py-2 font-medium">Value</th>
                        <th className="px-3 py-2 font-medium">TTL</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="w-10 px-2 py-2">
                          <span className="sr-only">Copy</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedRecords.map((record) => {
                        const verified = active || record.status === "verified";
                        return (
                          <tr
                            key={`${record.type}-${record.name}-${record.value}`}
                            className="border-t"
                          >
                            <td className="px-3 py-3 font-mono">{record.type}</td>
                            <td className="px-3 py-3 font-mono">{record.name}</td>
                            <td className="max-w-sm break-all px-3 py-3 font-mono text-xs">
                              {record.value}
                            </td>
                            <td className="px-3 py-3 text-muted-foreground">Auto</td>
                            <td className="px-3 py-3">
                              <Badge
                                variant="outline"
                                className={
                                  verified
                                    ? "border-emerald-200 text-emerald-700 dark:border-emerald-900 dark:text-emerald-300"
                                    : "border-amber-200 text-amber-700 dark:border-amber-900 dark:text-amber-300"
                                }
                              >
                                {verified ? "Verified" : "Pending"}
                              </Badge>
                            </td>
                            <td className="px-2 py-3">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                onClick={() => navigator.clipboard.writeText(record.value)}
                                aria-label={`Copy ${record.type} record value`}
                              >
                                <Copy className="size-3.5" />
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-4 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  DNS instructions will appear after the gateway provider accepts this domain.
                </p>
              )}

              {domain.providerError ? (
                <p className="mt-3 flex items-start gap-2 text-sm text-destructive">
                  <CircleAlert className="mt-0.5 size-4 shrink-0" /> {domain.providerError}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default function Domains({ loaderData, actionData }: Route.ComponentProps) {
  const revalidator = useRevalidator();
  const syncer = useFetcher();
  const [dialogOpen, setDialogOpen] = useState(false);
  const pending = loaderData.domains.some(
    (domain) =>
      domain.kind === "custom" && domain.status !== "active" && domain.status !== "deleted",
  );
  const syncSubmit = syncer.submit;

  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => {
      if (syncer.state === "idle") syncSubmit({ intent: "syncAll" }, { method: "post" });
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [pending, syncSubmit, syncer.state]);
  useEffect(() => {
    if (syncer.state === "idle" && syncer.data) revalidator.revalidate();
  }, [syncer.state, syncer.data, revalidator]);

  const organizers = loaderData.chapters.filter((chapter) =>
    loaderData.manageableIds.includes(chapter.chapterId),
  );
  return (
    <DashboardShell user={loaderData.user}>
      <DashboardPage>
        <DashboardPageHeader
          title="Domains"
          actions={
            organizers.length > 0 ? (
              <Button
                type="button"
                onClick={() => setDialogOpen(true)}
                disabled={loaderData.remainingDomains === 0}
              >
                <Plus className="size-4" /> Connect a domain you own
              </Button>
            ) : null
          }
        />

        {actionData && "error" in actionData ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {actionData.error}
          </p>
        ) : null}

        <div className="space-y-3">
          {loaderData.domains.map((domain) => (
            <DomainCard
              key={domain.id}
              domain={domain}
              chapterSlug={
                loaderData.chapters.find((chapter) => chapter.chapterId === domain.ownerChapterId)
                  ?.chapterSlug
              }
            />
          ))}
        </div>

        {organizers.length > 0 ? (
          <ConnectDomainDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            organizers={organizers}
            disabled={loaderData.remainingDomains === 0}
          />
        ) : null}
      </DashboardPage>
    </DashboardShell>
  );
}
