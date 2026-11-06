import { Badge, PageHeader, Stack } from "@gdgjp/design-system";
import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { AppLayout, type ShellUser } from "./AppLayout";

export type CampaignHeader = {
  slug: string;
  name: string;
  status: "draft" | "active" | "closed";
  chapterSlug: string;
};

const STATUS = { draft: "準備中", active: "告知中", closed: "終了" } as const;
const TONE = { draft: "neutral", active: "success", closed: "info" } as const;

/** Tabs of a campaign. Later stages add their pages here. */
export const CAMPAIGN_TABS = [
  { path: "", label: "概要" },
  { path: "brief", label: "brief" },
  { path: "plan", label: "計画" },
  { path: "schedule", label: "スケジュール" },
  { path: "drafts", label: "下書き" },
  { path: "assets", label: "画像" },
  { path: "live", label: "当日実況" },
  { path: "reviews", label: "レビュー" },
  { path: "approvals", label: "承認" },
  { path: "members", label: "メンバー" },
  { path: "settings", label: "設定" },
] as const;

export function CampaignLayout({
  user,
  accountsUrl,
  campaign,
  title,
  actions,
  tabs = CAMPAIGN_TABS,
  children,
}: {
  user: ShellUser;
  accountsUrl: string;
  campaign: CampaignHeader;
  title: string;
  actions?: ReactNode;
  tabs?: readonly { path: string; label: string }[];
  children: ReactNode;
}) {
  return (
    <AppLayout user={user} accountsUrl={accountsUrl}>
      <Stack className="[word-break:auto-phrase]">
        <PageHeader
          title={title}
          description={
            <span className="inline-flex flex-wrap items-center gap-2">
              {campaign.name}
              <Badge tone={TONE[campaign.status]}>{STATUS[campaign.status]}</Badge>
              <span className="text-muted">{campaign.chapterSlug}</span>
            </span>
          }
          actions={actions}
        />
        <nav aria-label="キャンペーン" className="flex flex-wrap gap-1 border-b border-border pb-2">
          {tabs.map((tab) => (
            <NavLink
              key={tab.path}
              to={`/c/${campaign.slug}${tab.path ? `/${tab.path}` : ""}`}
              end
              className={({ isActive }) =>
                `rounded-md px-3 py-1.5 text-sm ${isActive ? "bg-selected font-semibold text-foreground" : "text-muted hover:text-foreground"}`
              }
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
        {children}
      </Stack>
    </AppLayout>
  );
}
