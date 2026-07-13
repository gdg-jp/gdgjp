import {
  BarChart3,
  Check,
  Copy,
  ExternalLink,
  FolderTree,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { SourceCombobox, type SourceOption } from "~/components/campaigns/source-combobox";
import { campaignSourceUrl } from "~/components/campaigns/source-url";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Popover, PopoverAnchor, PopoverContent } from "~/components/ui/popover";
import type { Link as DbLink } from "~/lib/db";

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
}: {
  item: LinkCardItem;
  shortUrlBase: string;
  shortHost: string;
  sources?: SourceOption[];
}) {
  const [source, setSource] = useState("");
  const [copyFeedback, setCopyFeedback] = useState<{ url: string } | null>(null);
  const { link, owner, clicks, campaign } = item;
  const favicon = faviconUrl(link.destinationUrl);
  const shortUrl = `${shortUrlBase}/${link.slug}`;
  const shortDisplay = `${shortHost}/${link.slug}`;

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

  return (
    <div className="group grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border bg-card px-3 py-3 shadow-xs transition-shadow hover:shadow-sm sm:flex sm:px-4">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-full border bg-background">
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
        <div className="flex min-w-0 flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-1.5">
          <Link
            to={`/links/${link.id}`}
            prefetch="intent"
            className="truncate text-sm font-medium text-foreground hover:underline"
            title={shortDisplay}
          >
            {shortDisplay}
          </Link>
          {sources ? (
            <SourceCombobox value={source} sources={sources} onValueChange={setSource} />
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
                className={`rounded p-1 transition-colors transition-opacity focus-visible:opacity-100 ${
                  copyFeedback
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                } ${sources ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
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
              className="truncate hover:text-foreground hover:underline"
              title={`${campaign.campaignName} / ${campaign.channelName}`}
            >
              {campaign.campaignName} / {campaign.channelName}
            </Link>
          </div>
        ) : null}
        <a
          href={link.destinationUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          title={link.destinationUrl}
        >
          <span className="text-muted-foreground/70">↳</span>
          <span className="truncate">{link.destinationUrl}</span>
        </a>
      </div>

      <div className="hidden items-center gap-2 sm:flex">
        <Avatar size="sm" title={owner?.name || owner?.email || "Owner"}>
          <AvatarImage src={owner?.image ?? undefined} alt={owner?.name || owner?.email || ""} />
          <AvatarFallback>{ownerInitials(owner)}</AvatarFallback>
        </Avatar>
        <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">
          {formatDate(link.createdAt)}
        </span>
      </div>

      <Link
        to={`/analytics?linkId=${link.id}`}
        prefetch="intent"
        className="col-start-2 row-start-2 inline-flex w-fit items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        title="View analytics"
      >
        <BarChart3 className="size-3.5 text-primary" />
        <span className="tabular-nums">{clicks}</span>
        <span>{clicks === 1 ? "click" : "clicks"}</span>
      </Link>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Link actions"
            className="col-start-3 row-start-2"
          >
            <MoreHorizontal className="size-4" />
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
          <DropdownMenuItem asChild variant="destructive">
            <Link to={`/links/${link.id}`} prefetch="intent">
              <Trash2 className="size-4" />
              Delete…
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
