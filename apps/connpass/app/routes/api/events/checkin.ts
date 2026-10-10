import { getBearerIdentity } from "@gdgjp/gdg-lib";
import type { ActionFunctionArgs } from "react-router";
import { accountsBaseUrl } from "~/features/auth/accounts-url.server";
import { canWriteGroup, getAllowedGroupByNumericId } from "~/features/auth/authorize.server";
import { checkInInBrowser } from "~/features/connpass/connpass-browser-read.server";
import { parseCheckinUrl } from "~/features/connpass/ui/checkin";

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== "POST")
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  const { env } = context.cloudflare;
  const identity = await getBearerIdentity(request, accountsBaseUrl(env));
  if (!identity) return Response.json({ error: "invalid_token" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
  const checkin = parseCheckinUrl(body?.url);
  if (!checkin) return Response.json({ error: "invalid_checkin_url" }, { status: 400 });

  try {
    const result = await checkInInBrowser(env, checkin, async (groupNumericId) => {
      const group = await getAllowedGroupByNumericId(env.DB, groupNumericId);
      return group != null && canWriteGroup(identity, group);
    });
    if (result === "forbidden") return Response.json({ error: "forbidden" }, { status: 403 });
    return Response.json({ checkedIn: result === "checked_in" });
  } catch (error) {
    console.error("connpass_checkin_failed", error);
    return Response.json({ checkedIn: false });
  }
}
