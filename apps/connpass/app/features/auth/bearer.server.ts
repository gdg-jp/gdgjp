import { getBearerIdentity } from "@gdgjp/gdg-lib";
import { accountsBaseUrl } from "./accounts-url.server";
import { type ConnpassIdentity, withWriteAuthority } from "./authorize.server";

export async function connpassIdentity(
  request: Request,
  env: Env,
  trustedClientIds: readonly string[] = [],
): Promise<ConnpassIdentity | null> {
  const identity = await getBearerIdentity(request, accountsBaseUrl(env));
  return identity ? withWriteAuthority(identity, trustedClientIds) : null;
}

export function checkinClientIds(env: Pick<Env, "CHECKIN_CLIENT_IDS">): string[] {
  return (env.CHECKIN_CLIENT_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}
