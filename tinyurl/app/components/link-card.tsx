import {
  Archive,
  BarChart3,
  Check,
  Copy,
  ExternalLink,
  FolderTree,
  MoreHorizontal,
  MousePointerClick,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { SourceCombobox, type SourceOption } from "~/components/campaigns/source-combobox";
import { campaignSourceUrl } from "~/components/campaigns/source-url";
import type { DisplayLayout, DisplayProperty } from "~/components/dashboard-display-menu";
import { type LinkAction, LinkActionDialog } from "~/components/link-action-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Popover, PopoverAnchor, PopoverContent } from "~/components/ui/popover";
import type { Link as DbLink, Tag as DbTag } from "~/lib/db";
import { cn } from "~/lib/utils";

export type LinkOwner = {
  id: string;
  name: string;
  email: string;
  image: string | null;
};

export type LinkCardItem = {
  link: DbLink;
  owner?: LinkOwner;
  clicks: number;
  tags?: DbTag[];
  campaign?: {
    campaignId: number;
    campaignName: string;
    campaignCode: string;
    channelId: number;
    channelName: string;
    channelCode: string;
  };
};

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function faviconUrl(destinationUrl: string): string | null {
  const host = hostnameOf(destinationUrl);
  if (!host) return null;
  return `https://www.google.com/s2/favicons?domain=${host}&sz=64`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDate(unix: number): string {
  const d = new Date(unix * 1000);
  const now = new Date();
  const sameYear = d.getUTCFullYear() === now.getUTCFullYear();
  return sameYear
    ? `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
    : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function ownerInitials(owner?: LinkOwner): string {
  if (!owner) return "?";
  const source = owner.name || owner.email || owner.id;
  const parts = source.split(/\s+|@/).filter(Boolean);
  const a = parts[0]?.[0] ?? "";
  const b = parts[1]?.[0] ?? "";
  return (a + b).toUpperCase() || "?";
}

export function LinkCard({
  item,
  shortUrlBase,
  shortHost,
  sources,
  layout = "cards",
  properties = ["shortLink", "destinationUrl", "createdDate", "creator", "tags", "analytics"],
}: {
  item: LinkCardItem;
  shortUrlBase: string;
  shortHost: string;
  sources?: SourceOption[];
  layout?: DisplayLayout;
  properties?: DisplayProperty[];
}) {
  const [source, setSource] = useState("");
  const [copyFeedback, setCopyFeedback] = useState<{ url: string } | null>(null);
  const [linkAction, setLinkAction] = useState<LinkAction | null>(null);
  const { link, owner, clicks, campaign, tags = [] } = item;
  const favicon = faviconUrl(link.destinationUrl);
  const linkHost = link.domainHostname ?? shortHost;
  const shortUrl = `https://${linkHost}/${link.slug}`;
  const shortDisplay = linkHost === "go.gdgs.jp" ? `go/${link.slug}` : `${linkHost}/${link.slug}`;

  useEffect(() => {
    if (!copyFeedback) return;
    const timeout = window.setTimeout(() => setCopyFeedback(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [copyFeedback]);

  async function copyShort() {
    const url = (source && campaignSourceUrl(shortUrl, source)) || shortUrl;
    await navigator.clipboard.writeText(url);
    setCopyFeedback({ url });
  }

  const viewTransitionName = `link-${link.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  if (layout === "rows") {
    return (
      <>
        <div
          className={cn(
            "group relative flex min-h-14 min-w-0 items-center gap-2 bg-card px-3 py-2 transition-colors hover:bg-muted/35 sm:min-w-[780px] sm:gap-3 sm:px-4",
            link.archivedAt !== null && "bg-muted/25 opacity-75",
          )}
          style={{ viewTransitionName }}
        >
          <Link
            to={`/links/${link.id}`}
            prefetch="intent"
            aria-label={`View details for ${shortDisplay}`}
            className="peer absolute inset-0 z-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
          />

          <div className="hidden size-7 shrink-0 items-center justify-center rounded-full border bg-background sm:flex">
            {favicon ? (
              <img
                src={favicon}
                alt=""
                width={18}
                height={18}
                className="size-4 rounded-sm"
                referrerPolicy="no-referrer"
              />
            ) : (
              <ExternalLink className="size-3.5 text-muted-foreground" />
            )}
          </div>

          {properties.includes("shortLink") ? (
            <div className="flex min-w-0 flex-[1.1] items-center gap-0.5 sm:w-52 sm:flex-none sm:gap-1">
              <span
                className="truncate text-sm font-semibold peer-hover:underline peer-focus-visible:underline"
                title={shortDisplay}
              >
                {shortDisplay}
              </span>
              <Popover
                open={copyFeedback !== null}
                onOpenChange={(open) => {
                  if (!open) setCopyFeedback(null);
                }}
              >
                <PopoverAnchor asChild>
                  <button
                    type="button"
                    onClick={copyShort}
                    aria-label={copyFeedback ? "Copied short URL" : "Copy short URL"}
                    className="relative z-10 shrink-0 rounded p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:opacity-100 sm:opacity-60 sm:hover:opacity-100"
                  >
                    {copyFeedback ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  </button>
                </PopoverAnchor>
                <PopoverContent
                  side="bottom"
                  align="end"
                  sideOffset={6}
                  className="w-72 space-y-1.5 p-3"
                  onOpenAutoFocus={(event) => event.preventDefault()}
                  onCloseAutoFocus={(event) => event.preventDefault()}
                >
                  <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
                    <Check className="size-3.5" /> Copied
                  </div>
                  <p
                    className="break-all font-mono text-xs text-muted-foreground"
                    aria-live="polite"
                  >
                    {copyFeedback?.url}
                  </p>
                </PopoverContent>
              </Popover>
            </div>
          ) : null}

          {link.archivedAt !== null ? (
            <Badge variant="secondary" className="hidden sm:inline-flex">
              Archived
            </Badge>
          ) : null}

          {properties.includes("destinationUrl") ? (
            <a
              href={link.destinationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="relative z-10 flex min-w-0 flex-1 items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
              title={link.destinationUrl}
            >
              <span aria-hidden="true" className="shrink-0 text-muted-foreground/70">
                →
              </span>
              <span className="truncate">{link.destinationUrl}</span>
            </a>
          ) : (
            <span className="min-w-0 flex-1" />
          )}

          {properties.includes("title") && link.title ? (
            <span className="hidden max-w-32 truncate text-sm sm:inline" title={link.title}>
              {link.title}
            </span>
          ) : null}
          {properties.includes("description") && link.description ? (
            <span
              className="hidden max-w-40 truncate text-sm text-muted-foreground sm:inline"
              title={link.description}
            >
              {link.description}
            </span>
          ) : null}
          {properties.includes("creator") ? (
            <span className="hidden sm:inline-flex">
              <Avatar size="sm" title={owner?.name || owner?.email || "Owner"}>
                <AvatarImage
                  src={owner?.image ?? undefined}
                  alt={owner?.name || owner?.email || ""}
                />
                <AvatarFallback>{ownerInitials(owner)}</AvatarFallback>
              </Avatar>
            </span>
          ) : null}
          {properties.includes("createdDate") ? (
            <span className="hidden w-16 shrink-0 text-right text-sm text-muted-foreground tabular-nums sm:inline">
              {formatDate(link.createdAt)}
            </span>
          ) : null}
          {properties.includes("tags") && tags.length > 0 ? (
            <div className="relative z-10 hidden max-w-28 shrink-0 items-center gap-1 sm:flex">
              <Badge variant="outline" className="max-w-20 truncate text-xs">
                {tags[0].name}
              </Badge>
              {tags.length > 1 ? (
                <span className="text-xs text-muted-foreground">+{tags.length - 1}</span>
              ) : null}
            </div>
          ) : null}
          {properties.includes("analytics") ? (
            <Link
              to={`/analytics?linkId=${link.id}`}
              prefetch="intent"
              className="relative z-10 inline-flex shrink-0 items-center gap-1 rounded-md border bg-background px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:gap-1.5 sm:px-2.5 sm:py-1"
              title="View analytics"
            >
              <MousePointerClick className="size-3.5 text-primary sm:hidden" />
              <BarChart3 className="hidden size-3.5 text-primary sm:block" />
              <span className="tabular-nums">{clicks}</span>
              <span className="hidden sm:inline">{clicks === 1 ? "click" : "clicks"}</span>
            </Link>
          ) : null}
          <LinkActionsMenu link={link} copyShort={copyShort} onAction={setLinkAction} />
        </div>
        {linkAction ? (
          <LinkActionDialog
            action={linkAction}
            linkId={link.id}
            linkSlug={shortDisplay}
            destinationUrl={link.destinationUrl}
            open
            onOpenChange={(open) => !open && setLinkAction(null)}
          />
        ) : null}
      </>
    );
  }

  return (
    <>
      <div
        className={cn(
          "group relative grid min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)_auto_auto] items-center border bg-card shadow-xs transition-shadow hover:shadow-sm sm:flex",
          layout === "cards" ? "gap-3 rounded-xl px-4 py-3 sm:px-4" : "gap-2 rounded-md px-3 py-2",
          link.archivedAt !== null && "bg-muted/30 opacity-75",
        )}
        style={{ viewTransitionName }}
      >
        <Link
          to={`/links/${link.id}`}
          prefetch="intent"
          aria-label={`View details for ${shortDisplay}`}
          className="peer absolute inset-0 z-0 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
        <div
          className={cn(
            "hidden shrink-0 items-center justify-center rounded-full border bg-background sm:flex",
            layout === "cards" ? "size-10" : "size-8",
          )}
        >
          {favicon ? (
            <img
              src={favicon}
              alt=""
              width={20}
              height={20}
              className="size-5 rounded-sm"
              referrerPolicy="no-referrer"
            />
          ) : (
            <ExternalLink className="size-4 text-muted-foreground" />
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div
            className={cn(
              "flex min-w-0 sm:flex-row sm:items-center sm:gap-1.5",
              sources ? "flex-col items-start gap-1" : "flex-row items-center gap-1.5",
            )}
          >
            {properties.includes("shortLink") ? (
              <span
                className="truncate text-sm font-medium text-foreground peer-hover:underline peer-focus-visible:underline"
                title={shortDisplay}
              >
                {shortDisplay}
              </span>
            ) : null}
            {link.archivedAt !== null ? <Badge variant="secondary">Archived</Badge> : null}
            {sources ? (
              <div className="relative z-10">
                <SourceCombobox value={source} sources={sources} onValueChange={setSource} />
              </div>
            ) : null}
            <Popover
              open={copyFeedback !== null}
              onOpenChange={(open) => {
                if (!open) setCopyFeedback(null);
              }}
            >
              <PopoverAnchor asChild>
                <button
                  type="button"
                  onClick={copyShort}
                  aria-label={copyFeedback ? "Copied short URL" : "Copy short URL"}
                  className={`relative z-10 rounded p-1 transition-colors transition-opacity focus-visible:opacity-100 ${
                    copyFeedback
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  } ${sources ? "opacity-100" : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100"}`}
                >
                  {copyFeedback ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                </button>
              </PopoverAnchor>
              <PopoverContent
                side="bottom"
                align="end"
                sideOffset={6}
                className="w-72 space-y-1.5 p-3"
                onOpenAutoFocus={(event) => event.preventDefault()}
                onCloseAutoFocus={(event) => event.preventDefault()}
              >
                <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
                  <Check className="size-3.5" /> Copied
                </div>
                <p className="break-all font-mono text-xs text-muted-foreground" aria-live="polite">
                  {copyFeedback?.url}
                </p>
              </PopoverContent>
            </Popover>
          </div>
          {campaign ? (
            <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
              <FolderTree className="size-3 shrink-0" />
              <Link
                to={`/campaigns/${campaign.campaignId}`}
                className="relative z-10 truncate hover:text-foreground hover:underline"
                title={`${campaign.campaignName} / ${campaign.channelName}`}
              >
                {campaign.campaignName} / {campaign.channelName}
              </Link>
            </div>
          ) : null}
          {properties.includes("title") && link.title ? (
            <p className="truncate text-xs font-medium" title={link.title}>
              {link.title}
            </p>
          ) : null}
          {properties.includes("description") && link.description ? (
            <p className="line-clamp-2 text-xs text-muted-foreground">{link.description}</p>
          ) : null}
          {properties.includes("destinationUrl") ? (
            <a
              href={link.destinationUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="relative z-10 inline-flex w-fit max-w-full min-w-0 self-start items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              title={link.destinationUrl}
            >
              <span className="text-muted-foreground/70">↳</span>
              <span className="truncate">{link.destinationUrl}</span>
            </a>
          ) : null}
          {properties.includes("tags") && tags.length > 0 ? (
            <div className="relative z-10 flex flex-wrap gap-1 pt-0.5">
              {tags.map((tag) => (
                <Badge key={tag.id} variant="outline" className="text-[10px]">
                  {tag.name}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>

        {properties.includes("creator") || properties.includes("createdDate") ? (
          <div className="hidden items-center gap-2 sm:flex">
            {properties.includes("creator") ? (
              <Avatar size="sm" title={owner?.name || owner?.email || "Owner"}>
                <AvatarImage
                  src={owner?.image ?? undefined}
                  alt={owner?.name || owner?.email || ""}
                />
                <AvatarFallback>{ownerInitials(owner)}</AvatarFallback>
              </Avatar>
            ) : null}
            {properties.includes("createdDate") ? (
              <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">
                {formatDate(link.createdAt)}
              </span>
            ) : null}
          </div>
        ) : null}

        {properties.includes("analytics") ? (
          <Link
            to={`/analytics?linkId=${link.id}`}
            prefetch="intent"
            className="relative z-10 col-start-2 row-start-1 inline-flex w-fit items-center gap-1.5 self-center rounded-lg border bg-background px-2.5 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:rounded-full sm:px-2.5 sm:py-1"
            title="View analytics"
          >
            <MousePointerClick className="size-4 text-primary sm:hidden" />
            <BarChart3 className="hidden size-3.5 text-primary sm:block" />
            <span className="tabular-nums">{clicks}</span>
            <span className="hidden sm:inline">{clicks === 1 ? "click" : "clicks"}</span>
          </Link>
        ) : null}

        <LinkActionsMenu link={link} copyShort={copyShort} onAction={setLinkAction} />
      </div>
      {linkAction ? (
        <LinkActionDialog
          action={linkAction}
          linkId={link.id}
          linkSlug={shortDisplay}
          destinationUrl={link.destinationUrl}
          open
          onOpenChange={(open) => !open && setLinkAction(null)}
        />
      ) : null}
    </>
  );
}

function LinkActionsMenu({
  link,
  copyShort,
  onAction,
}: {
  link: DbLink;
  copyShort: () => void;
  onAction: (action: LinkAction) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Link actions"
          className="relative z-10 col-start-3 row-start-1 shrink-0 self-center"
        >
          <MoreHorizontal className="size-4 rotate-90 sm:rotate-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link to={`/links/${link.id}`} prefetch="intent">
            <Pencil className="size-4" />
            Edit
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to={`/analytics?linkId=${link.id}`} prefetch="intent">
            <BarChart3 className="size-4" />
            Analytics
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={copyShort}>
          <Copy className="size-4" />
          Copy short URL
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={link.destinationUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="size-4" />
            Visit destination
          </a>
        </DropdownMenuItem>
        {link.archivedAt === null ? (
          <DropdownMenuItem onSelect={() => onAction("archive")}>
            <Archive className="size-4" />
            Archive…
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => onAction("restore")}>
            <RotateCcw className="size-4" />
            Restore…
          </DropdownMenuItem>
        )}
        <DropdownMenuItem variant="destructive" onSelect={() => onAction("delete")}>
          <Trash2 className="size-4" />
          Delete…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
