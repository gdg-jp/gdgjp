export type PostStatus =
  | "scheduled"
  | "waiting_for_photo"
  | "posting"
  | "published"
  | "failed"
  | "needs_confirmation";

export type Post = {
  id: string;
  chapterId: number;
  xAccountId: string;
  text: string;
  scheduledAt: string;
  condition: "scheduled" | "photo_required";
  status: PostStatus;
  createdByUserId: string;
  publishedXPostId: string | null;
  publishedAt: string | null;
  failureReason: string | null;
  linkPreviewUrl: string | null;
  linkPreviewTitle: string | null;
  linkPreviewDescription: string | null;
  linkPreviewImageUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PostMedia = {
  id: string;
  postId: string;
  r2Key: string;
  contentType: string;
  byteSize: number;
  altText: string;
  sortOrder: number;
  createdAt: string;
};

export type PostCondition = "scheduled" | "photo_required";

/** Resolved OGP/Twitter-card metadata for the first URL in a post's text. */
export type LinkPreview = {
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
};

export type CreateDraftInput = {
  chapterId: number;
  xAccountId: string;
  text: string;
  scheduledAt: string;
  condition: PostCondition;
  createdByUserId: string;
  /** Normalized/resolved through the selected X account, maximum 10. */
  tagHandles?: string[];
};

export type UpdateDraftPatch = Partial<
  Pick<CreateDraftInput, "xAccountId" | "text" | "scheduledAt" | "condition" | "tagHandles">
>;

export type AttachMediaInput = {
  bytes: ArrayBuffer;
  contentType: string;
  altText?: string;
  sortOrder: number;
};

export type MediaMetadataEdit = { id: string; altText: string; sortOrder: number };

export type PostDetail = { post: Post; media: PostMedia[] };

/**
 * Everything the aggregate draft service needs that a route (or a future CLI
 * caller) supplies. Link-preview derivation and X-handle resolution are
 * injected so the service itself stays free of `fetch`/crypto/`Env`.
 */
export type PostDraftDependencies = {
  db: D1Database;
  media: R2Bucket;
  linkPreviewForText: (text: string) => Promise<LinkPreview | null>;
  resolveTagHandle: (
    xAccountId: string,
    handle: string,
  ) => Promise<{ id: string; username: string }>;
};
