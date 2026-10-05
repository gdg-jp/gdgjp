import { Badge, Button, Card, Icons, Stack } from "@gdgjp/design-system";
import { useState } from "react";
import { Form } from "react-router";
import type { UserSummary } from "~/features/auth/user.repository";
import { CreateSourceDialog } from "~/features/campaigns/components/channel-dialogs";
import { EditChannelDialog } from "~/features/campaigns/components/channel-dialogs";
import { EditSourceDialog } from "~/features/campaigns/components/channel-dialogs";
import type { DetailChannel } from "~/features/campaigns/detail-types";
import type { DetailCampaign } from "~/features/campaigns/detail-types";
import type { AvailableTag } from "~/features/campaigns/detail-types";
import type { CampaignsPageData } from "~/features/campaigns/detail.server";
import { CreateLinkDialog } from "~/features/links/components/create-link-dialog";
import { LinkCard } from "~/features/links/components/link-card";

export function shortHostOf(base: string): string {
  try {
    return new URL(base).host;
  } catch {
    return base.replace(/^https?:\/\//, "");
  }
}

export function ChannelCard({
  campaign,
  channel,
  owners,
  availableTags,
  chapters,
  shortUrlBase,
  clicks,
}: {
  campaign: DetailCampaign;
  channel: DetailChannel;
  owners: Record<string, UserSummary>;
  availableTags: AvailableTag[];
  chapters: CampaignsPageData["chapters"];
  shortUrlBase: string;
  clicks: Record<string, number>;
}) {
  const [open, setOpen] = useState(true);

  return (
    <Card className="gap-0 py-0">
      <Stack>
        <div className="flex flex-col items-stretch gap-3 px-4 py-4 sm:flex-row sm:items-center sm:px-5">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
          >
            <span className="flex size-9 items-center justify-center rounded-lg bg-surface">
              <Icons name="Radio" aria-hidden="true" className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="font-medium">{channel.name}</span>
              <span className="ml-2 font-mono text-xs text-muted">{channel.code}</span>
              {channel.archivedAt !== null ? <Badge className="ml-2">Archived</Badge> : null}
              <span className="block text-xs text-muted">
                {channel.links.length} links · {channel.sources.length} sources
              </span>
            </span>
            <Icons
              name="ChevronDown"
              aria-hidden="true"
              className={`ml-auto size-4 transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>
          <div className="flex flex-wrap items-center justify-end gap-2 sm:flex-nowrap">
            {channel.archivedAt === null ? (
              <>
                <CreateSourceDialog channelId={channel.id} />
                <CreateLinkDialog
                  availableTags={availableTags}
                  defaultCampaignChannelId={channel.id}
                  campaignChannelOptions={[
                    {
                      id: channel.id,
                      campaignName: campaign.name,
                      campaignCode: campaign.code,
                      defaultDestinationUrl: campaign.defaultDestinationUrl,
                      channelName: channel.name,
                      channelCode: channel.code,
                    },
                  ]}
                  chapters={chapters}
                  shortUrlBase={shortUrlBase}
                  trigger={
                    <Button size="sm">
                      <Icons name="Link2" aria-hidden="true" className="size-4" />
                      Create link
                    </Button>
                  }
                />
              </>
            ) : null}
            <EditChannelDialog channel={channel} />
            <Form method="post">
              <input
                type="hidden"
                name="intent"
                value={channel.archivedAt === null ? "archiveChannel" : "restoreChannel"}
              />
              <input type="hidden" name="channelId" value={channel.id} />
              <Button type="submit" variant="ghost">
                {channel.archivedAt === null ? (
                  <Icons name="Archive" aria-hidden="true" className="size-4" />
                ) : (
                  <Icons name="RotateCcw" aria-hidden="true" className="size-4" />
                )}
                <span className="sr-only">
                  {channel.archivedAt === null ? "Archive" : "Restore"} {channel.name}
                </span>
              </Button>
            </Form>
          </div>
        </div>
        {open ? (
          <div className="min-w-0 border-t px-3 py-4 sm:px-5">
            {channel.sources.length > 0 ? (
              <div className="mb-4 flex flex-wrap gap-2">
                {channel.sources.map((source) => (
                  <div
                    key={source.id}
                    className="flex items-center rounded-md border bg-surface/50 pl-2"
                  >
                    <Icons name="Users" aria-hidden="true" className="mr-1 size-3" />
                    <span className="text-xs">
                      {source.name} <code>{source.code}</code>
                    </span>
                    {source.archivedAt !== null ? (
                      <Badge className="ml-1 text-[10px]">Archived</Badge>
                    ) : null}
                    <EditSourceDialog source={source} />
                    <Form method="post">
                      <input
                        type="hidden"
                        name="intent"
                        value={source.archivedAt === null ? "archiveSource" : "restoreSource"}
                      />
                      <input type="hidden" name="sourceId" value={source.id} />
                      <Button type="submit" variant="ghost" className="size-7">
                        {source.archivedAt === null ? (
                          <Icons name="Archive" aria-hidden="true" className="size-3" />
                        ) : (
                          <Icons name="RotateCcw" aria-hidden="true" className="size-3" />
                        )}
                        <span className="sr-only">
                          {source.archivedAt === null ? "Archive" : "Restore"} {source.name}
                        </span>
                      </Button>
                    </Form>
                  </div>
                ))}
              </div>
            ) : null}
            {channel.links.length === 0 ? (
              <p className="py-5 text-center text-sm text-muted">No links assigned yet.</p>
            ) : (
              <div className="space-y-3">
                {channel.links.map((link) => (
                  <div key={link.id}>
                    <LinkCard
                      item={{
                        link,
                        owner: owners[link.ownerUserId] ?? {
                          id: link.ownerUserId,
                          name: "",
                          email: "",
                        },
                        clicks: clicks[link.id] ?? 0,
                        campaign: {
                          campaignId: campaign.id,
                          campaignName: campaign.name,
                          campaignCode: campaign.code,
                          channelId: channel.id,
                          channelName: channel.name,
                          channelCode: channel.code,
                        },
                      }}
                      shortUrlBase={shortUrlBase}
                      shortHost={shortHostOf(shortUrlBase)}
                      sources={channel.sources.filter((source) => source.archivedAt === null)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </Stack>
    </Card>
  );
}
