import type { ImportKindDriver } from "../tick";
import { stepAttachments } from "./attachments";
import { completeImport, stepFinalizing, stepGrouping } from "./finalize";
import { stepListing } from "./listing";
import type { Current, DiscordImportPhase, DiscordImportTickContext } from "./shared";

export { DISCORD_PAGE_SIZE } from "./shared";
export type { DiscordImportPhase, StepOutcome } from "./shared";

export const discordImportDriver: ImportKindDriver<
  Exclude<DiscordImportPhase, "complete" | "error">
> = {
  kind: "discord-channel",
  phases: ["listing", "attachments", "grouping", "finalizing"],
  needsAccessToken: false,
  requiredScopes: [],
  async step(phase, ctx, current) {
    const discordCtx = ctx as DiscordImportTickContext;
    const discordCurrent = current as Current;
    if (phase === "listing") return stepListing(discordCtx, discordCurrent);
    if (phase === "attachments") return stepAttachments(discordCtx, discordCurrent);
    if (phase === "grouping") return stepGrouping(discordCtx, discordCurrent);
    return stepFinalizing(discordCtx, discordCurrent);
  },
  complete(ctx, current) {
    return completeImport(ctx as DiscordImportTickContext, current as Current);
  },
};
