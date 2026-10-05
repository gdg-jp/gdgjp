import { REQUIRED_GOOGLE_CHAT_SCOPES } from "../../../../../app/features/google/drive.server";
import { GOOGLE_CHAT_REAUTH_MESSAGE } from "../../google-chat";
import type { ImportKindDriver } from "../tick";
import { stepAttachments } from "./attachments";
import { completeImport, stepFinalizing, stepGrouping } from "./finalize";
import { stepIndexing, stepListing } from "./listing";
import { stepSenders } from "./senders";
import type { ChatImportPhase, ChatImportTickContext, Current } from "./shared";

export { CHAT_PAGE_SIZE, SENDERS_FLUSH_BATCH_SIZE } from "./shared";
export type { ChatImportPhase, StepOutcome } from "./shared";

/**
 * Chat's existing phase workers are a driver too. Keeping them as a driver
 * removes the Queue/DO kind fork while preserving each phase's established
 * subrequest accounting during the extraction to import/chat/.
 */
export const chatImportDriver: ImportKindDriver<Exclude<ChatImportPhase, "complete" | "error">> = {
  kind: "google-chat-space",
  phases: ["listing", "indexing", "senders", "attachments", "grouping", "finalizing"],
  needsAccessToken: true,
  requiredScopes: REQUIRED_GOOGLE_CHAT_SCOPES,
  authorizationErrorMessage: GOOGLE_CHAT_REAUTH_MESSAGE,
  async step(phase, ctx, current) {
    const chatCtx = ctx as ChatImportTickContext;
    const chatCurrent = current as Current;
    if (phase === "listing") return stepListing(chatCtx, chatCurrent);
    if (phase === "indexing") return stepIndexing(chatCtx, chatCurrent);
    if (phase === "senders") return stepSenders(chatCtx, chatCurrent);
    if (phase === "attachments") return stepAttachments(chatCtx, chatCurrent);
    if (phase === "grouping") return stepGrouping(chatCtx, chatCurrent);
    return stepFinalizing(chatCtx, chatCurrent);
  },
  complete(ctx, current) {
    return completeImport(ctx as ChatImportTickContext, current as Current);
  },
};
