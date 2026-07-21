import { isGoogleSheetsUrl } from "../../../../app/lib/google-drive-utils";
import {
  exportFileAsText,
  extractFileId,
  getDriveFileName,
} from "../../../../app/lib/google-drive.server";

export interface GoogleAccessTokenProvider {
  getAccessToken(): Promise<string>;
}

/** Google API adapter. Token lookup/refresh persistence is injected from the
 * Persistence layer, keeping database access out of this Tool implementation. */
export function createGoogleDriveTool(tokens: GoogleAccessTokenProvider) {
  return {
    async exportDocument(url: string): Promise<{ title: string; text: string }> {
      const fileId = extractFileId(url);
      const token = await tokens.getAccessToken();
      const title = await getDriveFileName(fileId, token).catch(() => fileId);
      const mimeType = isGoogleSheetsUrl(url) ? "text/csv" : "text/plain";
      return { title, text: await exportFileAsText(fileId, token, mimeType) };
    },
  };
}
