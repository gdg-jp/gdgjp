import type { CampaignsPageData } from "~/features/campaigns/detail.server";

export type DetailChannel = CampaignsPageData["channels"][number];

export type AssignableLink = CampaignsPageData["assignableLinks"][number];

export type DetailCampaign = CampaignsPageData["campaign"];

export type AvailableTag = CampaignsPageData["availableTags"][number];
