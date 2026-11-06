// Contracts for pr.gdgs.jp → sns / tinyurl / connpass service-binding RPC (WorkerEntrypoint
// `PrService` in each app). Types only. Each callee authorizes `actor` with its own existing
// permission rules; pr never decides another app's permissions.
import type { AuthUser, UserChapter } from "./auth";

/** The person the call is made for (their live claims at approval, or a stored snapshot in cron). */
export type PrActor = { user: AuthUser; chapters: UserChapter[] };

/** RPC methods never throw across the binding: failures are values. */
export type PrRpcFailure = { ok: false; code: string; message?: string };
export type PrRpcResult<T> = ({ ok: true } & T) | PrRpcFailure;

// ── sns ────────────────────────────────────────────────────────────────────────

export type SnsXAccountSummary = { id: string; username: string; displayName: string };

export type SnsCreateScheduledPostInput = {
  actor: PrActor;
  chapterId: number;
  xAccountId: string;
  text: string;
  /** ISO instant. */
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

// ── tinyurl ────────────────────────────────────────────────────────────────────

export type TinyurlLinkSummary = { id: string; slug: string; shortUrl: string };

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
  }): Promise<PrRpcResult<{ link: TinyurlLinkSummary }>>;
  updateLink(input: {
    actor: PrActor;
    linkId: string;
    ogImageUrl?: string | null;
    destinationUrl?: string;
  }): Promise<PrRpcResult<{ link: TinyurlLinkSummary }>>;
  getAnalytics(input: {
    actor: PrActor;
    campaignId: number;
    from: string;
    to: string;
    bucket?: "hour" | "day";
  }): Promise<PrRpcResult<{ analytics: unknown }>>;
}
