import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Icons,
  PageHeader,
  Stack,
} from "@gdgjp/design-system";
import type { ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { AppLayout, type ShellUser } from "./AppLayout";

export type CampaignHeader = {
  slug: string;
  name: string;
  status: "draft" | "active" | "closed";
  chapterSlug?: string;
};

const STATUS = { draft: "準備中", active: "告知中", closed: "終了" } as const;
const TONE = { draft: "neutral", active: "success", closed: "info" } as const;

/** What people use every day: the thread, the schedule, the numbers. */
export const CAMPAIGN_TABS = [
  { path: "", label: "秘書" },
  { path: "schedule", label: "予定表" },
  { path: "metrics", label: "数値" },
] as const;

/** Everything else is one menu away. */
export const CAMPAIGN_DETAILS = [
  { path: "brief", label: "brief（イベントの情報）" },
  { path: "plan", label: "計画" },
  { path: "drafts", label: "下書き" },
  { path: "reviews", label: "レビュー" },
  { path: "approvals", label: "承認と依頼" },
  { path: "assets", label: "画像" },
  { path: "live", label: "当日実況" },
  { path: "budget", label: "予算" },
  { path: "members", label: "メンバー" },
  { path: "settings", label: "設定" },
] as const;

export function CampaignLayout({
  campaign,
  title,
  actions,
  children,
}: {
  user?: ShellUser;
  accountsUrl?: string;
  campaign: CampaignHeader;
  title: string;
  actions?: ReactNode;
  tabs?: readonly { path: string; label: string }[];
  children: ReactNode;
}) {
  const base = `/c/${campaign.slug}`;
  const { pathname } = useLocation();
  const detail = CAMPAIGN_DETAILS.find(
    (d) => pathname === `${base}/${d.path}` || pathname.startsWith(`${base}/${d.path}/`),
  );
  return (
    <AppLayout>
      <Stack className="[word-break:auto-phrase]">
        <PageHeader
          title={campaign.name}
          description={
            <span className="inline-flex flex-wrap items-center gap-2">
              <Badge tone={TONE[campaign.status]}>{STATUS[campaign.status]}</Badge>
              {title && title !== campaign.name ? <span>{title}</span> : null}
            </span>
          }
          actions={actions}
        />
        <nav
          aria-label="イベント"
          className="flex flex-wrap items-center gap-1 border-b border-border pb-2"
        >
          {CAMPAIGN_TABS.map((tab) => (
            <NavLink
              key={tab.path}
              to={`${base}${tab.path ? `/${tab.path}` : ""}`}
              end={tab.path === ""}
              className={({ isActive }) =>
                `rounded-md px-3 py-1.5 text-sm ${isActive ? "bg-selected font-semibold text-foreground" : "text-muted hover:text-foreground"}`
              }
            >
              {tab.label}
            </NavLink>
          ))}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={detail ? "bg-selected font-semibold" : undefined}
              >
                {detail ? detail.label : "詳細"}
                <Icons name="ChevronDown" size={14} aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {CAMPAIGN_DETAILS.map((d) => (
                <DropdownMenuItem key={d.path} asChild>
                  <Link to={`${base}/${d.path}`}>{d.label}</Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>
        {children}
      </Stack>
    </AppLayout>
  );
}
