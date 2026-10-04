export type LinkVisibility = "private" | "public";

export type Link = {
  id: string;
  domainId?: number;
  domainHostname?: string;
  slug: string;
  destinationUrl: string;
  title: string | null;
  description: string | null;
  ogImageUrl: string | null;
  ownerUserId: string;
  ownerChapterId: number | null;
  campaignChannelId: number | null;
  folderId: number | null;
  visibility: LinkVisibility;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  deletedAt: number | null;
};

export type LinkRow = {
  id: string;
  domain_id?: number;
  domain_hostname?: string;
  slug: string;
  destination_url: string;
  title: string | null;
  description: string | null;
  og_image_url: string | null;
  owner_user_id: string;
  owner_chapter_id: number | null;
  campaign_channel_id: number | null;
  folder_id: number | null;
  visibility: LinkVisibility;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
  deleted_at: number | null;
};

export function toLink(row: LinkRow): Link {
  return {
    id: row.id,
    domainId: row.domain_id ?? 1,
    domainHostname: row.domain_hostname ?? "gdgs.jp",
    slug: row.slug,
    destinationUrl: row.destination_url,
    title: row.title,
    description: row.description,
    ogImageUrl: row.og_image_url,
    ownerUserId: row.owner_user_id,
    ownerChapterId: row.owner_chapter_id,
    campaignChannelId: row.campaign_channel_id,
    folderId: row.folder_id ?? null,
    visibility: row.visibility,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    deletedAt: row.deleted_at,
  };
}

export function linkColumns(tableRef: "links" | "l" = "links"): string {
  const columns = [
    "id",
    "domain_id",
    "slug",
    "destination_url",
    "title",
    "description",
    "og_image_url",
    "owner_user_id",
    "owner_chapter_id",
    "campaign_channel_id",
    "folder_id",
    "visibility",
    "created_at",
    "updated_at",
    "archived_at",
    "deleted_at",
  ];
  const qualified = columns.map((column) => `${tableRef}.${column}`);
  qualified.splice(
    2,
    0,
    `(SELECT d.hostname FROM domains AS d WHERE d.id = ${tableRef}.domain_id) AS domain_hostname`,
  );
  return qualified.join(", ");
}

export const LINK_COLS = linkColumns();

export type LinkRole = "editor" | "viewer";

export type PrincipalType = "user" | "chapter";

// ---------- Comments ----------

export type Comment = {
  id: number;
  linkId: string;
  authorUserId: string;
  body: string;
  createdAt: number;
};

export type CommentRow = {
  id: number;
  link_id: string;
  author_user_id: string;
  body: string;
  created_at: number;
};

export function toComment(row: CommentRow): Comment {
  return {
    id: row.id,
    linkId: row.link_id,
    authorUserId: row.author_user_id,
    body: row.body,
    createdAt: row.created_at,
  };
}

export const COMMENT_COLS = "id, link_id, author_user_id, body, created_at";

// ---------- Permissions ----------

export type LinkPermission = {
  id: number;
  linkId: string;
  principalType: PrincipalType;
  principalId: string;
  role: LinkRole;
  createdAt: number;
};

export type LinkPermissionRow = {
  id: number;
  link_id: string;
  principal_type: PrincipalType;
  principal_id: string;
  role: LinkRole;
  created_at: number;
};

export function toLinkPermission(row: LinkPermissionRow): LinkPermission {
  return {
    id: row.id,
    linkId: row.link_id,
    principalType: row.principal_type,
    principalId: row.principal_id,
    role: row.role,
    createdAt: row.created_at,
  };
}

export const PERM_COLS = "id, link_id, principal_type, principal_id, role, created_at";
