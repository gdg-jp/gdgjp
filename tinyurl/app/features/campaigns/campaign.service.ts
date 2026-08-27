import { isSuperAdmin } from "@gdgjp/gdg-lib";
import type { AuthUser, UserChapter } from "@gdgjp/gdg-lib";
import { validatePublicHttpUrl } from "~/lib/ogp";
import { type FeatureFailure, featureFailure } from "../shared/errors";
import { canAccessCampaign, chapterIdsAreOwnedByCaller } from "./campaign-policy";
import {
  type CursorPage,
  getCampaignById,
  getCampaignChannelById,
  getCampaignChannelSourceById,
  listCampaignChannelSourcesPage,
  listCampaignChannelsPage,
  listCampaignsForCallerPage,
  normalizeCampaignCode,
  archiveCampaign as repoArchiveCampaign,
  archiveCampaignChannel as repoArchiveCampaignChannel,
  archiveCampaignChannelSource as repoArchiveCampaignChannelSource,
  createCampaign as repoCreateCampaign,
  createCampaignChannel as repoCreateCampaignChannel,
  createCampaignChannelSource as repoCreateCampaignChannelSource,
  updateCampaign as repoUpdateCampaign,
  updateCampaignChannel as repoUpdateCampaignChannel,
  updateCampaignChannelSource as repoUpdateCampaignChannelSource,
} from "./campaign.repository";
import type {
  Campaign,
  CampaignChannel,
  CampaignChannelSource,
  CampaignWithCounts,
} from "./campaign.types";

export type CampaignServiceActor = { user: AuthUser; chapters: UserChapter[] };

function validateName(name: string, maxLength: number, label: string): FeatureFailure | null {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > maxLength) {
    return featureFailure("invalid_input", `${label} must be 1–${maxLength} characters.`);
  }
  return null;
}

function validateCode(code: string): FeatureFailure | null {
  try {
    normalizeCampaignCode(code);
    return null;
  } catch {
    return featureFailure(
      "invalid_input",
      "Code must be 1-32 lowercase letters, numbers, underscores, or hyphens.",
    );
  }
}

/**
 * Mirrors the dashboard's create/update validation: an empty string clears
 * the default (same as `null`), and any non-empty value must resolve to a
 * public http(s) URL — matching `validatePublicHttpUrl`'s rejection of
 * non-http(s) schemes and private/loopback addresses.
 */
async function validateDefaultDestinationUrl(
  value: string | null,
): Promise<{ ok: true; value: string | null } | FeatureFailure> {
  if (value === null || value === "") return { ok: true, value: null };
  const validation = await validatePublicHttpUrl(value);
  if (!validation.ok) {
    return featureFailure("invalid_input", `Default destination URL ${validation.reason}`);
  }
  return { ok: true, value: validation.url.toString() };
}

// ---------- Campaigns ----------

export async function createCampaignForActor(
  db: D1Database,
  actor: CampaignServiceActor,
  input: {
    name: string;
    code: string;
    defaultDestinationUrl?: string | null;
    chapterIds: number[];
  },
): Promise<{ ok: true; campaign: Campaign } | FeatureFailure> {
  const nameError = validateName(input.name, 80, "Name");
  if (nameError) return nameError;
  const codeError = validateCode(input.code);
  if (codeError) return codeError;
  if (!chapterIdsAreOwnedByCaller(actor.chapters, input.chapterIds)) {
    return featureFailure("invalid_input", "Select at least one chapter you belong to.");
  }
  const destinationCheck = await validateDefaultDestinationUrl(input.defaultDestinationUrl ?? null);
  if (!destinationCheck.ok) return destinationCheck;

  const result = await repoCreateCampaign(db, {
    name: input.name,
    code: input.code,
    defaultDestinationUrl: destinationCheck.value,
    ownerUserId: actor.user.id,
    chapterIds: input.chapterIds,
  });
  if (!result.ok)
    return featureFailure("conflict", `Campaign code "${input.code}" is already in use.`);
  return { ok: true, campaign: result.campaign };
}

export async function listCampaignsForActor(
  db: D1Database,
  actor: CampaignServiceActor,
  options: { includeArchived?: boolean; limit?: number; cursor?: number | null } = {},
): Promise<CursorPage<CampaignWithCounts>> {
  return listCampaignsForCallerPage(
    db,
    { isSuperAdmin: isSuperAdmin(actor.user), chapterIds: actor.chapters.map((c) => c.chapterId) },
    options,
  );
}

export async function loadCampaignForActor(
  db: D1Database,
  actor: CampaignServiceActor,
  id: number,
): Promise<{ ok: true; campaign: Campaign } | FeatureFailure> {
  const campaign = await getCampaignById(db, id);
  if (!campaign) return featureFailure("not_found", "Campaign not found.");
  if (!canAccessCampaign(actor.user, actor.chapters, campaign)) {
    return featureFailure("forbidden", "You do not have access to this campaign.");
  }
  return { ok: true, campaign };
}

export async function updateCampaignForActor(
  db: D1Database,
  actor: CampaignServiceActor,
  id: number,
  patch: {
    name?: string;
    code?: string;
    defaultDestinationUrl?: string | null;
    chapterIds?: number[];
  },
): Promise<{ ok: true; campaign: Campaign } | FeatureFailure> {
  const loaded = await loadCampaignForActor(db, actor, id);
  if (!loaded.ok) return loaded;

  if (patch.name !== undefined) {
    const nameError = validateName(patch.name, 80, "Name");
    if (nameError) return nameError;
  }
  if (patch.code !== undefined) {
    const codeError = validateCode(patch.code);
    if (codeError) return codeError;
  }
  if (patch.chapterIds !== undefined) {
    if (!chapterIdsAreOwnedByCaller(actor.chapters, patch.chapterIds)) {
      return featureFailure("invalid_input", "Select at least one chapter you belong to.");
    }
  }
  let defaultDestinationUrl = patch.defaultDestinationUrl;
  if (patch.defaultDestinationUrl !== undefined) {
    const destinationCheck = await validateDefaultDestinationUrl(patch.defaultDestinationUrl);
    if (!destinationCheck.ok) return destinationCheck;
    defaultDestinationUrl = destinationCheck.value;
  }

  const result = await repoUpdateCampaign(db, id, { ...patch, defaultDestinationUrl });
  if (!result) return featureFailure("not_found", "Campaign not found.");
  if (!result.ok) {
    return featureFailure("conflict", `Campaign code "${patch.code}" is already in use.`);
  }
  return { ok: true, campaign: result.campaign };
}

export async function archiveCampaignForActor(
  db: D1Database,
  actor: CampaignServiceActor,
  id: number,
): Promise<{ ok: true; campaign: Campaign } | FeatureFailure> {
  const loaded = await loadCampaignForActor(db, actor, id);
  if (!loaded.ok) return loaded;
  const campaign = await repoArchiveCampaign(db, id, true);
  if (!campaign) return featureFailure("not_found", "Campaign not found.");
  return { ok: true, campaign };
}

export async function restoreCampaignForActor(
  db: D1Database,
  actor: CampaignServiceActor,
  id: number,
): Promise<{ ok: true; campaign: Campaign } | FeatureFailure> {
  const loaded = await loadCampaignForActor(db, actor, id);
  if (!loaded.ok) return loaded;
  if (loaded.campaign.archivedAt === null) {
    return featureFailure("conflict", "Campaign is not archived.");
  }
  const campaign = await repoArchiveCampaign(db, id, false);
  if (!campaign) return featureFailure("not_found", "Campaign not found.");
  return { ok: true, campaign };
}

// ---------- Channels ----------

async function loadCampaignChannelForActor(
  db: D1Database,
  actor: CampaignServiceActor,
  campaignId: number,
  channelId: number,
): Promise<{ ok: true; campaign: Campaign; channel: CampaignChannel } | FeatureFailure> {
  const loaded = await loadCampaignForActor(db, actor, campaignId);
  if (!loaded.ok) return loaded;
  const channel = await getCampaignChannelById(db, channelId);
  if (!channel || channel.campaignId !== campaignId) {
    return featureFailure("not_found", "Channel not found.");
  }
  return { ok: true, campaign: loaded.campaign, channel };
}

export async function listCampaignChannelsForActor(
  db: D1Database,
  actor: CampaignServiceActor,
  campaignId: number,
  options: { includeArchived?: boolean; limit?: number; cursor?: number | null } = {},
): Promise<{ ok: true; page: CursorPage<CampaignChannel> } | FeatureFailure> {
  const loaded = await loadCampaignForActor(db, actor, campaignId);
  if (!loaded.ok) return loaded;
  return { ok: true, page: await listCampaignChannelsPage(db, campaignId, options) };
}

export async function createCampaignChannelForActor(
  db: D1Database,
  actor: CampaignServiceActor,
  campaignId: number,
  input: { name: string; code: string; sortOrder?: number },
): Promise<{ ok: true; channel: CampaignChannel } | FeatureFailure> {
  const loaded = await loadCampaignForActor(db, actor, campaignId);
  if (!loaded.ok) return loaded;
  const nameError = validateName(input.name, 64, "Channel name");
  if (nameError) return nameError;
  const codeError = validateCode(input.code);
  if (codeError) return codeError;

  const result = await repoCreateCampaignChannel(db, {
    campaignId,
    name: input.name,
    code: input.code,
    sortOrder: input.sortOrder,
  });
  if (!result.ok)
    return featureFailure("conflict", `Channel code "${input.code}" is already in use.`);
  return { ok: true, channel: result.channel };
}

export async function updateCampaignChannelForActor(
  db: D1Database,
  actor: CampaignServiceActor,
  campaignId: number,
  channelId: number,
  patch: { name?: string; code?: string; sortOrder?: number },
): Promise<{ ok: true; channel: CampaignChannel } | FeatureFailure> {
  const loaded = await loadCampaignChannelForActor(db, actor, campaignId, channelId);
  if (!loaded.ok) return loaded;
  if (patch.name !== undefined) {
    const nameError = validateName(patch.name, 64, "Channel name");
    if (nameError) return nameError;
  }
  if (patch.code !== undefined) {
    const codeError = validateCode(patch.code);
    if (codeError) return codeError;
  }

  const result = await repoUpdateCampaignChannel(db, channelId, patch);
  if (!result) return featureFailure("not_found", "Channel not found.");
  if (!result.ok)
    return featureFailure("conflict", `Channel code "${patch.code}" is already in use.`);
  return { ok: true, channel: result.channel };
}

export async function archiveCampaignChannelForActor(
  db: D1Database,
  actor: CampaignServiceActor,
  campaignId: number,
  channelId: number,
): Promise<{ ok: true; channel: CampaignChannel } | FeatureFailure> {
  const loaded = await loadCampaignChannelForActor(db, actor, campaignId, channelId);
  if (!loaded.ok) return loaded;
  const channel = await repoArchiveCampaignChannel(db, channelId, true);
  if (!channel) return featureFailure("not_found", "Channel not found.");
  return { ok: true, channel };
}

export async function restoreCampaignChannelForActor(
  db: D1Database,
  actor: CampaignServiceActor,
  campaignId: number,
  channelId: number,
): Promise<{ ok: true; channel: CampaignChannel } | FeatureFailure> {
  const loaded = await loadCampaignChannelForActor(db, actor, campaignId, channelId);
  if (!loaded.ok) return loaded;
  if (loaded.channel.archivedAt === null) {
    return featureFailure("conflict", "Channel is not archived.");
  }
  const channel = await repoArchiveCampaignChannel(db, channelId, false);
  if (!channel) return featureFailure("not_found", "Channel not found.");
  return { ok: true, channel };
}

// ---------- Sources ----------

async function loadCampaignChannelSourceForActor(
  db: D1Database,
  actor: CampaignServiceActor,
  campaignId: number,
  channelId: number,
  sourceId: number,
): Promise<
  | { ok: true; campaign: Campaign; channel: CampaignChannel; source: CampaignChannelSource }
  | FeatureFailure
> {
  const loaded = await loadCampaignChannelForActor(db, actor, campaignId, channelId);
  if (!loaded.ok) return loaded;
  const source = await getCampaignChannelSourceById(db, sourceId);
  if (!source || source.channelId !== channelId) {
    return featureFailure("not_found", "Source not found.");
  }
  return { ok: true, campaign: loaded.campaign, channel: loaded.channel, source };
}

export async function listCampaignChannelSourcesForActor(
  db: D1Database,
  actor: CampaignServiceActor,
  campaignId: number,
  channelId: number,
  options: { includeArchived?: boolean; limit?: number; cursor?: number | null } = {},
): Promise<{ ok: true; page: CursorPage<CampaignChannelSource> } | FeatureFailure> {
  const loaded = await loadCampaignChannelForActor(db, actor, campaignId, channelId);
  if (!loaded.ok) return loaded;
  return { ok: true, page: await listCampaignChannelSourcesPage(db, channelId, options) };
}

export async function createCampaignChannelSourceForActor(
  db: D1Database,
  actor: CampaignServiceActor,
  campaignId: number,
  channelId: number,
  input: { name: string; code: string },
): Promise<{ ok: true; source: CampaignChannelSource } | FeatureFailure> {
  const loaded = await loadCampaignChannelForActor(db, actor, campaignId, channelId);
  if (!loaded.ok) return loaded;
  const nameError = validateName(input.name, 64, "Source name");
  if (nameError) return nameError;
  const codeError = validateCode(input.code);
  if (codeError) return codeError;

  const result = await repoCreateCampaignChannelSource(db, {
    channelId,
    name: input.name,
    code: input.code,
  });
  if (!result.ok)
    return featureFailure("conflict", `Source code "${input.code}" is already registered.`);
  return { ok: true, source: result.source };
}

export async function updateCampaignChannelSourceForActor(
  db: D1Database,
  actor: CampaignServiceActor,
  campaignId: number,
  channelId: number,
  sourceId: number,
  patch: { name?: string; code?: string },
): Promise<{ ok: true; source: CampaignChannelSource } | FeatureFailure> {
  const loaded = await loadCampaignChannelSourceForActor(
    db,
    actor,
    campaignId,
    channelId,
    sourceId,
  );
  if (!loaded.ok) return loaded;
  if (patch.name !== undefined) {
    const nameError = validateName(patch.name, 64, "Source name");
    if (nameError) return nameError;
  }
  if (patch.code !== undefined) {
    const codeError = validateCode(patch.code);
    if (codeError) return codeError;
  }

  const result = await repoUpdateCampaignChannelSource(db, sourceId, patch);
  if (!result) return featureFailure("not_found", "Source not found.");
  if (!result.ok) {
    return featureFailure("conflict", `Source code "${patch.code}" is already registered.`);
  }
  return { ok: true, source: result.source };
}

export async function archiveCampaignChannelSourceForActor(
  db: D1Database,
  actor: CampaignServiceActor,
  campaignId: number,
  channelId: number,
  sourceId: number,
): Promise<{ ok: true; source: CampaignChannelSource } | FeatureFailure> {
  const loaded = await loadCampaignChannelSourceForActor(
    db,
    actor,
    campaignId,
    channelId,
    sourceId,
  );
  if (!loaded.ok) return loaded;
  const source = await repoArchiveCampaignChannelSource(db, sourceId, true);
  if (!source) return featureFailure("not_found", "Source not found.");
  return { ok: true, source };
}

export async function restoreCampaignChannelSourceForActor(
  db: D1Database,
  actor: CampaignServiceActor,
  campaignId: number,
  channelId: number,
  sourceId: number,
): Promise<{ ok: true; source: CampaignChannelSource } | FeatureFailure> {
  const loaded = await loadCampaignChannelSourceForActor(
    db,
    actor,
    campaignId,
    channelId,
    sourceId,
  );
  if (!loaded.ok) return loaded;
  if (loaded.source.archivedAt === null) {
    return featureFailure("conflict", "Source is not archived.");
  }
  const source = await repoArchiveCampaignChannelSource(db, sourceId, false);
  if (!source) return featureFailure("not_found", "Source not found.");
  return { ok: true, source };
}
