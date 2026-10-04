import type { LinkRole } from "~/features/links/link-record";
import type { PrincipalType } from "~/features/links/link-record";

// ---------- Folders ----------

export type Folder = {
  id: number;
  name: string;
  ownerUserId: string;
  parentFolderId: number | null;
  createdAt: number;
  updatedAt: number;
};

export type FolderRow = {
  id: number;
  name: string;
  owner_user_id: string;
  parent_folder_id: number | null;
  created_at: number;
  updated_at: number;
};

export const FOLDER_COLS = "id, name, owner_user_id, parent_folder_id, created_at, updated_at";

export function toFolder(row: FolderRow): Folder {
  return {
    id: row.id,
    name: row.name,
    ownerUserId: row.owner_user_id,
    parentFolderId: row.parent_folder_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type FolderViewer = {
  userId: string;
  email: string;
  chapterIds: number[];
  isSuperAdmin?: boolean;
};

export type FolderWithCounts = Folder & {
  linkCount: number;
  childFolderCount: number;
};

export type FolderPermission = {
  id: number;
  folderId: number;
  principalType: PrincipalType;
  principalId: string;
  role: LinkRole;
  createdAt: number;
};

export type FolderPermissionRow = {
  id: number;
  folder_id: number;
  principal_type: PrincipalType;
  principal_id: string;
  role: LinkRole;
  created_at: number;
};

export const FOLDER_PERMISSION_COLS =
  "id, folder_id, principal_type, principal_id, role, created_at";

export function toFolderPermission(row: FolderPermissionRow): FolderPermission {
  return {
    id: row.id,
    folderId: row.folder_id,
    principalType: row.principal_type,
    principalId: row.principal_id,
    role: row.role,
    createdAt: row.created_at,
  };
}
