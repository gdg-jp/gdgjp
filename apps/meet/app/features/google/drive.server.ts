import { type GoogleFetch, googleJsonRequest, paginateAll } from "~/features/google/client.server";

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";

const DEFAULT_FILE_FIELDS = "id,name,mimeType,webViewLink,parents,createdTime";
const DEFAULT_LIST_FILES_FIELDS =
  "nextPageToken,files(id,name,mimeType,webViewLink,parents,createdTime)";
const LIST_PERMISSIONS_FIELDS = "nextPageToken,permissions(id,type,role,emailAddress)";

export type DriveFile = {
  id: string;
  name?: string;
  mimeType?: string;
  webViewLink?: string;
  parents?: string[];
  createdTime?: string;
};

export type DrivePermission = {
  id: string;
  type: "user" | "group" | "domain" | "anyone" | string;
  role: "owner" | "organizer" | "fileOrganizer" | "writer" | "commenter" | "reader" | string;
  emailAddress?: string;
};

export async function getFile(
  accessToken: string,
  fileId: string,
  fields = DEFAULT_FILE_FIELDS,
  fetchFn?: GoogleFetch,
): Promise<DriveFile> {
  const params = new URLSearchParams({ fields });
  return googleJsonRequest<DriveFile>({
    accessToken,
    method: "GET",
    url: `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?${params.toString()}`,
    fetchFn,
  });
}

export async function listFiles(
  accessToken: string,
  options: { q: string; fields?: string; pageSize?: number },
  fetchFn?: GoogleFetch,
): Promise<DriveFile[]> {
  const fields = options.fields ?? DEFAULT_LIST_FILES_FIELDS;
  return paginateAll(
    (pageToken) => {
      const params = new URLSearchParams({ q: options.q, fields });
      if (options.pageSize) params.set("pageSize", String(options.pageSize));
      if (pageToken) params.set("pageToken", pageToken);
      return googleJsonRequest<{ files?: DriveFile[]; nextPageToken?: string }>({
        accessToken,
        method: "GET",
        url: `${DRIVE_API_BASE}/files?${params.toString()}`,
        fetchFn,
      });
    },
    (page) => page.files,
  );
}

export async function listPermissions(
  accessToken: string,
  fileId: string,
  fetchFn?: GoogleFetch,
): Promise<DrivePermission[]> {
  return paginateAll(
    (pageToken) => {
      const params = new URLSearchParams({ fields: LIST_PERMISSIONS_FIELDS });
      if (pageToken) params.set("pageToken", pageToken);
      return googleJsonRequest<{ permissions?: DrivePermission[]; nextPageToken?: string }>({
        accessToken,
        method: "GET",
        url: `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}/permissions?${params.toString()}`,
        fetchFn,
      });
    },
    (page) => page.permissions,
  );
}

export async function createPermission(
  accessToken: string,
  fileId: string,
  options: {
    emailAddress: string;
    role?: "reader" | "commenter" | "writer";
    type?: "user" | "group";
    sendNotificationEmail?: boolean;
  },
  fetchFn?: GoogleFetch,
): Promise<DrivePermission> {
  const params = new URLSearchParams({
    sendNotificationEmail: String(options.sendNotificationEmail ?? false),
  });
  return googleJsonRequest<DrivePermission>({
    accessToken,
    method: "POST",
    url: `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}/permissions?${params.toString()}`,
    body: {
      type: options.type ?? "user",
      role: options.role ?? "reader",
      emailAddress: options.emailAddress,
    },
    fetchFn,
  });
}
