import type { AuthUser, UserChapter } from "./auth";

export type PrActor = { user: AuthUser; chapters: UserChapter[] };

export type PrRpcFailure = { ok: false; code: string; message?: string };
export type PrRpcResult<T> = ({ ok: true } & T) | PrRpcFailure;

export type SnsXAccountSummary = { id: string; username: string; displayName: string };

export type SnsCreateScheduledPostInput = {
  actor: PrActor;
  chapterId: number;
  xAccountId: string;
  text: string;
  scheduledAt: string;
  condition: "scheduled" | "photo_required";
  tagHandles?: string[];
};

export type SnsAttachMediaInput = {
  actor: PrActor;
  chapterId: number;
  postId: string;
  bytes: ArrayBuffer;
  contentType: string;
  altText?: string;
  sortOrder: number;
};

export type SnsPostSummary = {
  id: string;
  status: string;
  scheduledAt: string;
  publishedXPostId: string | null;
  failureReason: string | null;
};

export interface SnsPrService {
  listXAccounts(input: { actor: PrActor; chapterId: number }): Promise<
    PrRpcResult<{ accounts: SnsXAccountSummary[]; canPost: boolean }>
  >;
  createScheduledPost(
    input: SnsCreateScheduledPostInput,
  ): Promise<PrRpcResult<{ post: SnsPostSummary }>>;
  updatePost(input: {
    actor: PrActor;
    chapterId: number;
    postId: string;
    text?: string;
    scheduledAt?: string;
  }): Promise<PrRpcResult<{ post: SnsPostSummary }>>;
  attachMedia(input: SnsAttachMediaInput): Promise<PrRpcResult<{ mediaId: string }>>;
  getPost(input: { actor: PrActor; chapterId: number; postId: string }): Promise<
    PrRpcResult<{ post: SnsPostSummary }>
  >;
}

export type TinyurlLinkSummary = { id: string; slug: string; shortUrl: string };

export type TinyurlApprovedVersion = { campaignId: number; draftId: number; version: number };

export interface TinyurlPrService {
  ensureCampaign(input: {
    actor: PrActor;
    chapterId: number;
    code: string;
    name: string;
    defaultDestinationUrl?: string | null;
  }): Promise<PrRpcResult<{ campaignId: number; created: boolean }>>;
  ensureChannel(input: { actor: PrActor; campaignId: number; code: string; name: string }): Promise<
    PrRpcResult<{ channelId: number; created: boolean }>
  >;
  createLink(input: {
    actor: PrActor;
    chapterId: number;
    slug: string;
    destinationUrl: string;
    title?: string | null;
    ogImageUrl?: string | null;
    campaignChannelId: number | null;
    approvedVersion?: TinyurlApprovedVersion;
  }): Promise<PrRpcResult<{ link: TinyurlLinkSummary; adopted?: boolean }>>;
  updateLink(input: {
    actor: PrActor;
    chapterId: number;
    linkId: string;
    ogImageUrl: string | null;
  }): Promise<PrRpcResult<{ link: TinyurlLinkSummary }>>;
  getAnalytics(input: {
    actor: PrActor;
    campaignId: number;
    from: string;
    to: string;
    bucket?: "hour" | "day";
  }): Promise<PrRpcResult<{ analytics: unknown }>>;
}

export type ConnpassJobSummary = {
  id: string;
  type: string;
  status: "queued" | "running" | "succeeded" | "failed";
  groupId: string;
  eventId: string | null;
  result: unknown;
  error: string | null;
};

export type ConnpassEventTarget = { actor: PrActor; groupSlug: string; eventId: string };

export type ConnpassSurveyQuestion = {
  title: string;
  answerType: "free_text" | "checkbox" | "radio" | "dropdown";
  required: boolean;
  options: string[] | null;
};

export interface ConnpassPrService extends ConnpassListingService {
  checkGroup(input: { actor: PrActor; groupSlug: string }): Promise<
    PrRpcResult<{ write: boolean; chapterId: string | null }>
  >;
  updateEvent(
    input: ConnpassEventTarget & {
      fields: {
        title?: string;
        subtitle?: string;
        description?: string;
        participantOnlyInfo?: string;
      };
    },
  ): Promise<PrRpcResult<{ job: ConnpassJobSummary }>>;
  publishEvent(input: ConnpassEventTarget): Promise<PrRpcResult<{ job: ConnpassJobSummary }>>;
  uploadImage(
    input: ConnpassEventTarget & { bytes: ArrayBuffer; contentType: string; name: string },
  ): Promise<PrRpcResult<{ job: ConnpassJobSummary }>>;
  upsertSurvey(
    input: ConnpassEventTarget & { questions: ConnpassSurveyQuestion[] },
  ): Promise<PrRpcResult<{ job: ConnpassJobSummary }>>;
  sendMessage(
    input: ConnpassEventTarget & { subject: string; body: string },
  ): Promise<PrRpcResult<{ job: ConnpassJobSummary }>>;
  sendGroupMessage(input: {
    actor: PrActor;
    groupSlug: string;
    subject: string;
    body: string;
  }): Promise<PrRpcResult<{ job: ConnpassJobSummary }>>;
  createSubEvent(
    input: ConnpassEventTarget & { title: string },
  ): Promise<PrRpcResult<{ job: ConnpassJobSummary }>>;
  getJob(input: { actor: PrActor; jobId: string }): Promise<
    PrRpcResult<{ job: ConnpassJobSummary }>
  >;
  getStats(input: ConnpassEventTarget): Promise<PrRpcResult<{ statistics: unknown }>>;
  listParticipants(input: ConnpassEventTarget): Promise<PrRpcResult<{ participants: unknown }>>;
}

export type ListingPlatform = "luma" | "techplay" | "findy" | "bevy";

export type EventListing = {
  mode: "mirror" | "pointer";
  title: string;
  subtitle?: string;
  summary: string;
  description: string;
  startAt: string;
  endAt: string;
  venue: { name: string; address?: string; online?: boolean };
  capacity?: number;
  feeYen?: number;
  registrationUrl?: string;
  imageUrl?: string;
  organizer: { name: string; contactEmail?: string };
  tags?: string[];
  tickets?: { name: string; priceYen: number; capacity?: number; audience?: string }[];
};

export type ListingTarget = { actor: PrActor; platform: ListingPlatform; targetId: string };

export interface ConnpassListingService {
  createListing(
    input: ListingTarget & { listing: EventListing; dryRun?: boolean },
  ): Promise<PrRpcResult<{ job: ConnpassJobSummary }>>;
}
