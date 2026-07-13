import {
  BarChart3,
  Copy,
  ExternalLink,
  FolderTree,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
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
import type { Link as DbLink } from "~/lib/db";

export type LinkOwner = {
  id: string;
  name: string;
  email: string;
};

export type LinkCardItem = {
  link: DbLink;
  owner?: LinkOwner;
  clicks: number;
  campaign?: {
    campaignId: number;
    campaignName: string;
    campaignCode: string;
    mediaId: number;
    mediaName: string;
    mediaCode: string;
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
  const { link, owner, clicks, campaign } = item;
  const favicon = faviconUrl(link.destinationUrl);
  const shortUrl = `${shortUrlBase}/${link.slug}`;
  const shortDisplay = `${shortHost}/${link.slug}`;

  async function copyShort() {
    const url = (source && campaignSourceUrl(shortUrl, source)) || shortUrl;
    await navigator.clipboard.writeText(url);
    toast.success("Copied to clipboard");
  }

  return (
    <div className="group flex items-center gap-3 rounded-xl border bg-card px-4 py-3 shadow-xs transition-shadow hover:shadow-sm">
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
        <div className="flex items-center gap-1.5">
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
          <button
            type="button"
            onClick={copyShort}
            aria-label="Copy short URL"
            className={`rounded p-1 text-muted-foreground transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 ${
              sources ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
          >
            <Copy className="size-3.5" />
          </button>
        </div>
        {campaign ? (
          <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
            <FolderTree className="size-3 shrink-0" />
            <Link
              to={`/campaigns/${campaign.campaignId}`}
              className="truncate hover:text-foreground hover:underline"
              title={`${campaign.campaignName} / ${campaign.mediaName}`}
            >
              {campaign.campaignName} / {campaign.mediaName}
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
          <AvatarImage src={undefined} alt={owner?.name || owner?.email || ""} />
          <AvatarFallback>{ownerInitials(owner)}</AvatarFallback>
        </Avatar>
        <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">
          {formatDate(link.createdAt)}
        </span>
      </div>

      <Link
        to={`/analytics?linkId=${link.id}`}
        prefetch="intent"
        className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        title="View analytics"
      >
        <BarChart3 className="size-3.5 text-primary" />
        <span className="tabular-nums">{clicks}</span>
        <span>{clicks === 1 ? "click" : "clicks"}</span>
      </Link>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Link actions">
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
