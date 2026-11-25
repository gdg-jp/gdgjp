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

export type PostDraftDependencies = {
  db: D1Database;
  media: R2Bucket;
  linkPreviewForText: (text: string) => Promise<LinkPreview | null>;
  resolveTagHandle: (
    xAccountId: string,
    handle: string,
  ) => Promise<{ id: string; username: string } | null>;
};
