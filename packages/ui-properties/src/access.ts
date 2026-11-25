import { readFileSync } from "node:fs";
import {
  type AccessScope,
  accessScope,
  inAccessScope,
  isTestDomain,
} from "../scripts/access-origin.mjs";
import type { Upstream } from "./forwarder";

export { type AccessScope, accessScope, inAccessScope };

export type AccessToken = { readonly id: string; readonly secret: string };

export function accessToken(env: Readonly<Record<string, string | undefined>>): AccessToken | null {
  const id = env.CF_ACCESS_CLIENT_ID;
  const secret = env.CF_ACCESS_CLIENT_SECRET;
  return id && secret ? { id, secret } : null;
}

export function browserEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(env))
    if (value !== undefined && !name.startsWith("CF_ACCESS_")) kept[name] = value;
  return kept;
}

export type FuzzAccess = { readonly scope: AccessScope; readonly upstream: Upstream };

const LOCAL_UPSTREAM = /^(127(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}):(\d{1,5})$/;

export function fuzzAccess(
  env: Readonly<Record<string, string | undefined>>,
  origins: readonly string[],
): FuzzAccess {
  const domain = env.UI_FUZZ_DOMAIN;
  const local = env.UI_FUZZ_LOCAL === "1";
  let upstream: Upstream = { kind: "dns" };
  if (local) {
    if (!domain || !isTestDomain(domain))
      throw new Error("UI_FUZZ_LOCAL=1 needs UI_FUZZ_DOMAIN under .test");
    const match = LOCAL_UPSTREAM.exec(env.UI_FUZZ_LOCAL_UPSTREAM ?? "");
    if (!match || !env.UI_FUZZ_LOCAL_CA)
      throw new Error(
        "UI_FUZZ_LOCAL=1 needs UI_FUZZ_LOCAL_UPSTREAM=127.x.x.x:PORT and UI_FUZZ_LOCAL_CA",
      );
    upstream = {
      kind: "loopback",
      address: match[1] as string,
      port: Number(match[2]),
      ca: readFileSync(env.UI_FUZZ_LOCAL_CA),
    };
  } else if (domain && isTestDomain(domain)) {
    throw new Error(`${domain} is a test domain; set UI_FUZZ_LOCAL=1`);
  }
  const scope = accessScope({ domain });
  if (accessToken(env))
    for (const origin of origins)
      if (!inAccessScope(scope, origin))
        throw new Error(
          `The Access token only goes to https origins on the slot domain; ${origin} is not one`,
        );
  return { scope, upstream };
}
