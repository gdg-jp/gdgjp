import { encryptSecret } from "~/lib/crypto.server";
import { nowIso } from "~/lib/utils";
import type { XAccountDependencies, XOAuthDependencies } from "./x-account.types";
import { exchangeXCode, randomVerifier, xAuthorizationUrl } from "./x-provider.server";

export function xAccountDepsFromEnv(env: Env): XAccountDependencies {
  return { db: env.DB };
}

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
