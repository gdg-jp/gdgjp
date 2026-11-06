import type {
  AuthUser,
  PrActor,
  SnsPrService,
  TinyurlPrService,
  UserChapter,
} from "@gdgjp/gdg-lib";

/** The sns / tinyurl `PrService` entrypoints (service bindings with `entrypoint = "PrService"`). */
export const snsService = (env: Env): SnsPrService => env.SNS as unknown as SnsPrService;
export const tinyurlService = (env: Env): TinyurlPrService =>
  env.TINYURL as unknown as TinyurlPrService;

export function actorOf(access: { user: AuthUser; chapters: UserChapter[] }): PrActor {
  return { user: access.user, chapters: access.chapters };
}

/** A stored `{ user, chapters }` snapshot (cron acts for the person who last approved). */
export function parseActor(raw: string | null | undefined): PrActor | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as PrActor;
    return value?.user?.id && Array.isArray(value.chapters) ? value : null;
  } catch {
    return null;
  }
}

/** RPC failures and thrown binding errors, as one message for dispatch_log and the screen. */
export async function callRpc<T>(
  run: () => Promise<({ ok: true } & T) | { ok: false; code: string; message?: string }>,
): Promise<({ ok: true } & T) | { ok: false; code: string; message?: string }> {
  try {
    return await run();
  } catch (error) {
    return {
      ok: false,
      code: "binding_error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
