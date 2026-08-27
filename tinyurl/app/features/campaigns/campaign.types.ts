import type { Link } from "~/lib/db";

export type Campaign = {
  id: number;
  name: string;
  code: string;
  defaultDestinationUrl: string | null;
  ownerUserId: string;
  chapterIds: number[];
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
};

export type CampaignWithCounts = Campaign & {
  channelCount: number;
  linkCount: number;
};

export type CampaignChannel = {
  id: number;
  campaignId: number;
  name: string;
  code: string;
  sortOrder: number;
  archivedAt: number | null;
};

export type CampaignChannelSource = {
  id: number;
  channelId: number;
  name: string;
  code: string;
  archivedAt: number | null;
};

export type CampaignChannelWithLinks = CampaignChannel & {
  sources: CampaignChannelSource[];
  links: Link[];
};

export type CampaignWithChannelLinks = Campaign & {
  channels: CampaignChannelWithLinks[];
};
