import { getGoogleDriveDocumentKind } from "../../../../app/lib/google-drive-utils";
import {
  exportFileAsText,
  extractFileId,
  getDriveFileName,
  getGoogleDocumentWithTabs,
} from "../../../../app/lib/google-drive.server";
import {
  type GoogleDocsWorkspaceNode,
  flattenGoogleDocsWorkspaceNodes,
} from "./google-docs/workspace";

export interface GoogleAccessTokenProvider {
  getAccessToken(): Promise<string>;
}

/** Google API adapter. Token lookup/refresh persistence is injected from the
 * Persistence layer, keeping database access out of this Tool implementation. */
export function createGoogleDriveTool(tokens: GoogleAccessTokenProvider) {
  return {
    async exportDocument(
      url: string,
    ): Promise<{ title: string; nodes: GoogleDocsWorkspaceNode[] }> {
      const fileId = extractFileId(url);
      const token = await tokens.getAccessToken();
      const documentKind = getGoogleDriveDocumentKind(url);
      if (!documentKind) throw new Error("Unsupported Google Workspace URL");

      console.log(
        JSON.stringify({
          component: "google-drive-ingestion",
          event: "source_read_started",
          fileId,
          documentKind,
        }),
      );

      try {
        if (documentKind === "document") {
          const document = await getGoogleDocumentWithTabs(fileId, token);
          const title = document.title?.trim() || fileId;
          return {
            title,
            nodes: flattenGoogleDocsWorkspaceNodes([{ document, id: fileId }]),
          };
        }

        const title = await getDriveFileName(fileId, token).catch(() => fileId);
        const exportMimeType = documentKind === "spreadsheet" ? "text/csv" : "text/plain";
        return {
          title,
          nodes: [
            {
              path: title,
              parentPath: null,
              title,
              kind: "google_document",
              content: await exportFileAsText(fileId, token, exportMimeType),
              externalId: fileId,
            },
          ],
        };
      } catch (error) {
        console.error(
          JSON.stringify({
            component: "google-drive-ingestion",
            event: "source_read_failed",
            fileId,
            documentKind,
            errorName: error instanceof Error ? error.name : typeof error,
            errorMessage: error instanceof Error ? error.message : String(error),
          }),
        );
        throw error;
      }
    },
  };
}
