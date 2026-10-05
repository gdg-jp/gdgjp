import { Globe2, Link2, LockKeyhole, UserRound, UsersRound } from "lucide-react";

export type PageRole = "viewer" | "commenter" | "editor";
export type GeneralAccess = "restricted" | "unlisted" | "public" | "organizer" | "member";
export type SubjectType = "email" | "chapter";

export interface ShareSubject {
  type: SubjectType;
  key: string;
  label: string;
  secondary: string;
  image?: string | null;
  userId?: string | null;
}

export interface PageAccessEntry {
  id: string;
  subjectType?: SubjectType;
  subjectKey?: string;
  subjectLabel?: string;
  role?: PageRole;
  userName?: string | null;
  userImage?: string | null;
  email?: string;
  pageRole?: PageRole;
  userId?: string | null;
}

export interface AccessData {
  accessList: PageAccessEntry[];
  owner?: { label?: string; name?: string; email?: string; image?: string | null } | null;
  myRole?: "owner" | PageRole | null;
  canManageSharing?: boolean;
  permissions?: { canManageSharing?: boolean };
  generalAccess?: GeneralAccess;
  generalRole?: PageRole;
  visibility?: GeneralAccess;
  parentId?: string | null;
  aclSyncedWithParent?: boolean;
  descendantCount?: number;
  syncedDescendantCount?: number;
}

export interface CandidateData {
  candidates: Array<
    Partial<ShareSubject> & {
      subjectType?: SubjectType;
      subjectKey?: string;
      subjectLabel?: string;
      secondaryText?: string;
    }
  >;
}

export interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  pageId: string;
  pageTitle: string;
  /** Kept optional while callers move to the new page-access response. */
  currentVisibility?: string;
  canManageAccess?: boolean;
  canChangeVisibility?: boolean;
}

export const ROLES: PageRole[] = ["viewer", "commenter", "editor"];
export const listboxRole = "listbox";
export const optionRole = "option";
export const GENERAL_ACCESS: { value: GeneralAccess; icon: typeof LockKeyhole; label: string }[] = [
  { value: "restricted", icon: LockKeyhole, label: "share_access_restricted" },
  { value: "unlisted", icon: Link2, label: "share_access_unlisted" },
  { value: "public", icon: Globe2, label: "share_access_public" },
  { value: "organizer", icon: UsersRound, label: "share_access_organizer" },
  { value: "member", icon: UserRound, label: "share_access_member" },
];
export const CHIP_EXIT_DURATION_MS = 180;
