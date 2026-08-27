import { encryptSecret } from "~/lib/crypto.server";
import { nowIso } from "~/lib/utils";
import type { XAccountDependencies, XOAuthDependencies } from "./x-account.types";
import { exchangeXCode, randomVerifier, xAuthorizationUrl } from "./x-provider.server";

/** Wires the list/revoke service to the Worker's D1 binding. */
export function xAccountDepsFromEnv(env: Env): XAccountDependencies {
  return { db: env.DB };
}

/** Wires the OAuth-transaction service to D1, the X provider, and token crypto. */
export function xOAuthDepsFromEnv(env: Env): XOAuthDependencies {
  return {
    db: env.DB,
    randomState: () => crypto.randomUUID(),
    randomVerifier,
    authorizationUrl: (state, verifier) => xAuthorizationUrl(env, state, verifier),
    exchangeCode: (code, verifier) => exchangeXCode(env, code, verifier),
    encryptToken: (plaintext) => encryptSecret(env.TOKEN_ENCRYPTION_KEY, plaintext),
    now: nowIso,
  };
}
