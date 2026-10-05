export type EventRow = {
  id: string;
  title: string;
  owner_user_id: string;
  owner_chapter_ids: string;
  status: "open" | "closed";
  created_at: number;
  google_admin_user_id: string | null;
  google_drive_folder_id: string | null;
  google_drive_folder_name: string | null;
};

export type PayEvent = {
  id: string;
  title: string;
  ownerUserId: string;
  ownerChapterIds: number[];
  status: "open" | "closed";
  createdAt: number;
  googleAdminUserId: string | null;
  googleDriveFolderId: string | null;
  googleDriveFolderName: string | null;
};
