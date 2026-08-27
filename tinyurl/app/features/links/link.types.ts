export type { Link, LinkPermission, LinkRole, LinkVisibility } from "~/lib/db";

export type LinkShareInput = {
  principalType: string;
  principalId: string;
  role: string;
};

export type LinkCreateInput = {
  /** Required to disambiguate a campaign chapter for multi-chapter CLI callers. */
  chapterId?: number;
};

export type CreateLinkInput = LinkCreateInput & {
  domainId: number;
  slug: string;
  destinationUrl: string;
  title?: string | null;
  description?: string | null;
  ogImageUrl?: string | null;
  visibility: "private" | "public";
  tagIds?: number[];
  newTagNames?: string[];
  comment?: string | null;
  campaignChannelId?: number | null;
  folderId?: number | null;
  shares?: LinkShareInput[];
};
