import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Icons,
} from "@gdgjp/design-system";
import { useState } from "react";
import type { ReactNode } from "react";
import { Form, useFetcher } from "react-router";
import type { Domain } from "~/features/domains";
import type { action } from "~/features/domains/page.server";

export function StatusBadge({ domain }: { domain: Domain }) {
  if (domain.status === "active") {
    return (
      <Badge tone="success">
        <Icons name="CheckCircle2" aria-hidden="true" /> Active
      </Badge>
    );
  }
  return (
    <Badge tone="danger">
      <Icons name="AlertCircle" aria-hidden="true" /> Invalid
    </Badge>
  );
}

export function ProgressItem({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      {done ? (
        <Icons name="CheckCircle2" aria-hidden="true" className="size-4 text-success" />
      ) : (
        <Icons name="LoaderCircle" aria-hidden="true" className="size-4 text-warning" />
      )}
      <span className={done ? "text-foreground" : "text-muted"}>{children}</span>
    </li>
  );
}

export function DomainActionsMenu({ domain }: { domain: Domain }) {
  const actionFetcher = useFetcher<typeof action>();
  const [removeOpen, setRemoveOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            type="button"
            variant="ghost"
            aria-label={`Actions for ${domain.hostname}`}
            className="shrink-0"
          >
            <Icons name="MoreHorizontal" aria-hidden="true" className="size-4" />
          </IconButton>
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
              <Icons name="RefreshCw" aria-hidden="true" className="size-4" />
              Check DNS now
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => navigator.clipboard.writeText(domain.hostname)}>
            <Icons name="Copy" aria-hidden="true" className="size-4" />
            Copy domain
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={`https://${domain.hostname}`} target="_blank" rel="noopener noreferrer">
              <Icons name="ExternalLink" aria-hidden="true" className="size-4" />
              Visit domain
            </a>
          </DropdownMenuItem>
          {domain.kind === "custom" ? (
            <DropdownMenuItem className="text-danger" onSelect={() => setRemoveOpen(true)}>
              <Icons name="Trash2" aria-hidden="true" className="size-4" />
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
              <div className="space-y-2">
                <AlertDialogTitle>Remove {domain.hostname}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This disconnects the domain from the gateway. Domains with active links cannot be
                  removed.
                </AlertDialogDescription>
              </div>
              <div className="mt-5">
                <AlertDialogCancel asChild>
                  <Button variant="outline" type="button">
                    Cancel
                  </Button>
                </AlertDialogCancel>
                <AlertDialogAction asChild>
                  <Button variant="danger" type="submit">
                    Remove domain
                  </Button>
                </AlertDialogAction>
              </div>
            </Form>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </>
  );
}

export function DomainCard({ domain, chapterSlug }: { domain: Domain; chapterSlug?: string }) {
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
      <section className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-1 rounded-xl border bg-surface px-3 py-3 shadow-xs sm:grid-cols-[auto_minmax(0,1fr)_minmax(7rem,0.45fr)_auto_auto] sm:gap-3 sm:px-4">
        <div className="grid size-10 shrink-0 place-items-center rounded-full border bg-background">
          <Icons name="Globe2" aria-hidden="true" className="size-4 text-muted" />
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium">{domain.hostname}</h2>
          <p className="truncate text-xs text-muted">System short-link domain</p>
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
    <section className="overflow-hidden rounded-xl border bg-surface shadow-xs transition-shadow hover:shadow-sm">
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-1 px-3 py-3 sm:grid-cols-[auto_minmax(0,1fr)_minmax(7rem,0.45fr)_auto_auto] sm:gap-3 sm:px-4">
        <div className="grid size-10 shrink-0 place-items-center rounded-full border bg-background">
          <Icons name="Globe2" aria-hidden="true" className="size-4 text-muted" />
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium">{domain.hostname}</h2>
          <p className="truncate text-xs text-muted">
            {domain.mode === "origin-first"
              ? `Existing website via ${domain.upstreamOrigin}`
              : "Short links only"}
            {chapterSlug ? ` · ${chapterSlug}` : ""}
          </p>
        </div>
        <div className="col-start-2 row-start-2 justify-self-start sm:col-start-3 sm:row-start-1 sm:justify-self-center">
          <StatusBadge domain={domain} />
        </div>
        <IconButton
          type="button"
          variant="outline"
          aria-label={expanded ? "Hide DNS configuration" : "Show DNS configuration"}
          aria-expanded={expanded}
          aria-controls={`domain-setup-${domain.id}`}
          onClick={() => setExpanded((value) => !value)}
          className="col-start-3 row-span-2 row-start-1 shrink-0 sm:col-start-4 sm:row-span-1"
        >
          <Icons
            name="ChevronDown"
            aria-hidden="true"
            className={`size-4 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </IconButton>
        <div className="col-start-4 row-span-2 row-start-1 sm:col-start-5 sm:row-span-1">
          <DomainActionsMenu domain={domain} />
        </div>
      </div>

      {expanded ? (
        <div>
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
                  <p className="mt-4 text-xs text-muted">
                    Last checked {new Date(domain.checkedAt * 1000).toLocaleString()}
                  </p>
                ) : null}
              </div>

              <div className="min-w-0">
                <div>
                  <h3 className="text-sm font-semibold">DNS records</h3>
                  <p className="mt-1 text-sm text-muted">
                    Add the pending ownership and routing records at your DNS provider. When an A
                    record is shown for the apex, do not add a CNAME for the same name.
                  </p>
                </div>

                <div className="mt-4 flex gap-3 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
                  <Icons
                    name="CloudDownload"
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0"
                  />
                  <div>
                    <p className="font-medium">Using Cloudflare DNS?</p>
                    <p className="mt-1 text-sky-800 dark:text-sky-200">
                      Keep Proxy status OFF for the A, AAAA, or CNAME routing record. It must show
                      as DNS only with a gray cloud. Cloudflare does not allow an apex CNAME
                      alongside an existing A/AAAA record, so use the displayed A record instead of
                      adding both.
                    </p>
                  </div>
                </div>

                {domain.mode === "origin-first" && domain.upstreamOrigin ? (
                  <div className="mt-4 rounded-lg border bg-surface/30 p-3 text-sm">
                    <p className="font-medium">Preserve the existing website first</p>
                    <p className="mt-1 text-muted">
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
                      <thead className="bg-surface/50 text-xs text-muted">
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
                              <td className="px-3 py-3 text-muted">Auto</td>
                              <td className="px-3 py-3">
                                <Badge className={verified ? "text-success" : "text-warning"}>
                                  {verified ? "Verified" : "Pending"}
                                </Badge>
                              </td>
                              <td className="px-2 py-3">
                                <IconButton
                                  type="button"
                                  variant="ghost"
                                  onClick={() => navigator.clipboard.writeText(record.value)}
                                  aria-label={`Copy ${record.type} record value`}
                                >
                                  <Icons name="Copy" aria-hidden="true" className="size-3.5" />
                                </IconButton>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="mt-4 rounded-lg border border-dashed p-4 text-sm text-muted">
                    DNS instructions will appear after the gateway provider accepts this domain.
                  </p>
                )}

                {domain.providerError ? (
                  <div className="mt-3 flex items-start gap-2 text-sm text-danger">
                    <Icons
                      name="AlertCircle"
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0"
                    />{" "}
                    {domain.providerError}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
