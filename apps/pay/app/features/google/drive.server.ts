import { googleFetch } from "./oauth.server";

const GOOGLE_DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const GOOGLE_SHEETS_MIME_TYPE = "application/vnd.google-apps.spreadsheet";

export type GoogleDriveItem = {
  id: string;
  name: string;
  mimeType: string;
};

export async function getAccessibleGoogleDriveItem(
  accessToken: string,
  fileId: string,
): Promise<GoogleDriveItem> {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
  url.search = new URLSearchParams({
    fields: "id,name,mimeType",
    supportsAllDrives: "true",
  }).toString();
  const response = await googleFetch(accessToken, url.toString());
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      response.status === 404
        ? "選択したGoogle Drive項目にアクセスできません。Google Pickerでもう一度選択してください"
        : `Google Drive項目の確認に失敗しました (${response.status})`,
    );
  }
  const item = await response.json<Partial<GoogleDriveItem>>();
  if (item.id !== fileId || typeof item.name !== "string" || typeof item.mimeType !== "string") {
    throw new Error("Google Driveから不正な項目情報が返されました");
  }
  return { id: item.id, name: item.name, mimeType: item.mimeType };
}

export function isGoogleDriveFolder(item: GoogleDriveItem): boolean {
  return item.mimeType === GOOGLE_DRIVE_FOLDER_MIME_TYPE;
}

export function isGoogleSpreadsheet(item: GoogleDriveItem): boolean {
  return item.mimeType === GOOGLE_SHEETS_MIME_TYPE;
}
