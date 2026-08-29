import { getGoogleDriveTokenRow } from "../../../../app/features/google/drive-token.server";
import { discordImportDriver } from "../discord-import";
import { chatImportDriver } from "../google-chat-import";
import { SourceAuthorizationError } from "../retry-classification";
import type { SubrequestBudget } from "../subrequest-budget";
import { ensureSourceImportDoSchema } from "./do-store";
import { driveImportDriver } from "./drive/phases";
import {
  ACCESS_TOKEN_SUBREQUESTS,
  CURRENT_RUN_SUBREQUESTS,
  type CurrentSourceImport,
  type SourceImportKind,
  type SourceImportStepOutcome,
  type SourceImportTickContext,
  commitPhase,
  currentRun,
} from "./run";
import { websiteImportDriver } from "./website/phases";

interface ImportKindDriverBase<P extends string> {
  kind: SourceImportKind;
  phases: readonly P[];
  step(
    phase: P,
    ctx: SourceImportTickContext,
    current: CurrentSourceImport,
  ): Promise<SourceImportStepOutcome>;
  complete(ctx: SourceImportTickContext, current: CurrentSourceImport): Promise<void>;
}

export type ImportKindDriver<P extends string = string> = ImportKindDriverBase<P> &
  (
    | {
        needsAccessToken: true;
        requiredScopes: readonly string[];
        /** Actionable terminal error when the stored OAuth grant is insufficient. */
        authorizationErrorMessage: string;
      }
    | {
        needsAccessToken: false;
        requiredScopes: readonly [];
        authorizationErrorMessage?: never;
      }
  );

const drivers = new Map<SourceImportKind, ImportKindDriver>([
  ["google-chat-space", chatImportDriver],
  ["discord-channel", discordImportDriver],
  ["website", websiteImportDriver],
  ["google-drive", driveImportDriver],
]);

/** Lets a driver module register itself without coupling the generic tick to its API client. */
export function registerSourceImportDriver(driver: ImportKindDriver): void {
  drivers.set(driver.kind, driver);
}

export function sourceImportDriver(kind: SourceImportKind): ImportKindDriver | undefined {
  return drivers.get(kind);
}

export async function advanceSourceImportTick(ctx: SourceImportTickContext): Promise<{
  finished: boolean;
  phase: string;
  subrequests: number;
  continueAfterMs?: number;
}> {
  if (!ctx.budget.canSpend(CURRENT_RUN_SUBREQUESTS)) {
    return { finished: false, phase: "start", subrequests: ctx.budget.spent };
  }
  ctx.budget.spend(CURRENT_RUN_SUBREQUESTS);
  const current = await currentRun(ctx.env, ctx.runId);
  if (!current) return { finished: true, phase: "complete", subrequests: ctx.budget.spent };
  ensureSourceImportDoSchema(ctx.sql);
  const driver = sourceImportDriver(current.run.kind as SourceImportKind);
  if (!driver) throw new Error(`No source import driver registered for ${current.run.kind}`);

  const pendingPhase = ctx.sql
    .exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", "pending_phase")
    .toArray()[0]?.value;
  if (pendingPhase && pendingPhase !== current.run.phase) {
    if (!ctx.budget.canSpend(1)) {
      return { finished: false, phase: current.run.phase, subrequests: ctx.budget.spent };
    }
    await commitPhase(ctx, current, pendingPhase);
  }

  if (driver.needsAccessToken) {
    if (!ctx.budget.canSpend(ACCESS_TOKEN_SUBREQUESTS)) {
      return { finished: false, phase: current.run.phase, subrequests: ctx.budget.spent };
    }
    ctx.budget.spend(ACCESS_TOKEN_SUBREQUESTS);
    const token = await getGoogleDriveTokenRow(ctx.env, current.db, current.source.addedBy);
    const granted = new Set((token.grantedScopes ?? "").split(/\s+/).filter(Boolean));
    if (!driver.requiredScopes.every((scope) => granted.has(scope))) {
      throw new SourceAuthorizationError(driver.authorizationErrorMessage);
    }
    ctx.accessToken = token.accessToken;
  }

  let phase = current.run.phase;
  if (phase === "start") {
    const first = driver.phases[0];
    if (!first) throw new Error(`Source import driver ${driver.kind} has no phases`);
    if (!ctx.budget.canSpend(1)) {
      return { finished: false, phase, subrequests: ctx.budget.spent };
    }
    await commitPhase(ctx, current, first);
    phase = first;
  }

  while (ctx.budget.remaining() > 0) {
    const index = driver.phases.indexOf(phase as never);
    if (index < 0) throw new Error(`Unknown ${driver.kind} import phase: ${phase}`);
    const outcome = await driver.step(phase as never, ctx, current);
    if (!outcome.phaseComplete) {
      return {
        finished: false,
        phase,
        subrequests: ctx.budget.spent,
        continueAfterMs: outcome.continueAfterMs,
      };
    }
    const next = driver.phases[index + 1];
    if (!next) {
      await driver.complete(ctx, current);
      return { finished: true, phase: "complete", subrequests: ctx.budget.spent };
    }
    if (!ctx.budget.canSpend(1)) {
      ctx.sql.exec(
        "INSERT INTO meta (key, value) VALUES ('pending_phase', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        next,
      );
      return { finished: false, phase, subrequests: ctx.budget.spent };
    }
    await commitPhase(ctx, current, next);
    phase = next;
  }
  return { finished: false, phase, subrequests: ctx.budget.spent };
}

export type { SourceImportTickContext } from "./run";
export type { SubrequestBudget };
