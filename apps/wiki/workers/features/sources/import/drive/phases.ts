import { GOOGLE_DRIVE_REAUTH_MESSAGE } from "../../../../../app/features/google/drive.server";
import type { CurrentSourceImport, SourceImportTickContext } from "../run";
import type { ImportKindDriver } from "../tick";
import { stepAssets } from "./steps/assets";
import { stepContent } from "./steps/content";
import { stepEnumerate } from "./steps/enumerate";
import { completeDriveImport, stepFinalizing } from "./steps/finalize";
import { stepMetadata } from "./steps/metadata";
import { stepRewrite } from "./steps/rewrite";

// Shared helpers / descriptors used by `phases.test.ts` and other Drive-import callers.
export {
  MAX_SHEET_PDF_ATTEMPTS,
  type SpreadsheetMetadata,
  type SpreadsheetUnitDescriptor,
  driveMetadataUrl,
  isSkippablePdfExport,
  sheetPdfRetryDelayMs,
  spreadsheetUnitDescriptors,
} from "./drive-import-shared";

export const DRIVE_PHASES = [
  "metadata",
  "enumerate",
  "content",
  "assets",
  "rewrite",
  "finalizing",
] as const;
export type DriveImportPhase = (typeof DRIVE_PHASES)[number];

export const driveImportDriver: ImportKindDriver<DriveImportPhase> = {
  kind: "google-drive" as const,
  phases: DRIVE_PHASES,
  needsAccessToken: true,
  requiredScopes: ["https://www.googleapis.com/auth/drive.readonly"] as const,
  authorizationErrorMessage: GOOGLE_DRIVE_REAUTH_MESSAGE,
  async step(phase: DriveImportPhase, ctx: SourceImportTickContext, current: CurrentSourceImport) {
    if (phase === "metadata") return stepMetadata(ctx, current);
    if (phase === "enumerate") return stepEnumerate(ctx, current);
    if (phase === "content") return stepContent(ctx, current);
    if (phase === "assets") return stepAssets(ctx, current);
    if (phase === "rewrite") return stepRewrite(ctx);
    return stepFinalizing(ctx, current);
  },
  complete: completeDriveImport,
};
