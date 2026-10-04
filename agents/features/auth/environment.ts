import { createLinkRedis, getRedis } from "../../lib/redis";
import type { LinkAccountDeps, LinkAccountEnv } from "./contracts";
import { type TokenKeyring, parseTokenEncryptionKeys } from "./token-crypto";
export function nowFn(deps: LinkAccountDeps): number {
  return (deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))();
}

export function requireEnv(env: LinkAccountEnv): void {
  if (!env.IDP_CLIENT_ID?.trim()) throw new Error("IDP_CLIENT_ID is not configured");
  if (!env.IDP_CLIENT_SECRET?.trim()) throw new Error("IDP_CLIENT_SECRET is not configured");
  if (!env.ACCOUNTS_URL?.trim()) throw new Error("ACCOUNTS_URL is not configured");
  if (!env.TOKEN_ENCRYPTION_KEYS?.trim()) {
    throw new Error("TOKEN_ENCRYPTION_KEYS is not configured");
  }
}

export function resolveKeyring(deps: LinkAccountDeps): TokenKeyring {
  return deps.keyring ?? parseTokenEncryptionKeys(deps.env.TOKEN_ENCRYPTION_KEYS);
}

/** Build deps from process env + shared Redis client. */
export function linkAccountDepsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<LinkAccountDeps> = {},
): LinkAccountDeps {
  return {
    env: {
      IDP_CLIENT_ID: env.IDP_CLIENT_ID ?? "",
      IDP_CLIENT_SECRET: env.IDP_CLIENT_SECRET ?? "",
      ACCOUNTS_URL: env.ACCOUNTS_URL ?? "https://accounts.gdgs.jp",
      TOKEN_ENCRYPTION_KEYS: env.TOKEN_ENCRYPTION_KEYS ?? "",
    },
    redis: overrides.redis ?? createLinkRedis(getRedis(env.REDIS_URL)),
    fetch: overrides.fetch,
    nowSeconds: overrides.nowSeconds,
    keyring: overrides.keyring,
  };
}
