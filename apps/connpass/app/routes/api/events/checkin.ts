import type { ActionFunctionArgs } from "react-router";
import {
  canWriteAnyGroup,
  canWriteGroup,
  getAllowedLumaCalendar,
} from "~/features/auth/authorize.server";
import { checkinClientIds, connpassIdentity } from "~/features/auth/bearer.server";
import { checkInWithFetch } from "~/features/connpass/checkin-fetch.server";
import { checkInInBrowser } from "~/features/connpass/connpass-browser-read.server";
import { parseCheckinUrl } from "~/features/connpass/ui/checkin";
import { parseLumaCheckinUrl } from "~/features/luma/checkin-url";
import { checkInLumaGuest } from "~/features/luma/checkin.server";

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== "POST")
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  const { env } = context.cloudflare;
  const identity = await connpassIdentity(request, env, checkinClientIds(env));
  if (!identity) return Response.json({ error: "invalid_token" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
  const connpassCheckin = parseCheckinUrl(body?.url);
  const lumaCheckin = connpassCheckin ? null : parseLumaCheckinUrl(body?.url);

  type Outcome = { checkedIn: boolean; userId: string | null; reason: string | null };
  let checkIn: () => Promise<Outcome | "forbidden">;
  if (connpassCheckin) {
    checkIn = async () => {
      if (!(await canWriteAnyGroup(env.DB, identity))) return "forbidden";
      const fast = await checkInWithFetch(env, connpassCheckin.url).catch(() => null);
      return fast ?? (await checkInInBrowser(env, connpassCheckin.url));
    };
  } else if (lumaCheckin) {
    checkIn = async () => {
      const result = await checkInLumaGuest(env, lumaCheckin, async (calendarApiId) => {
        const calendar = await getAllowedLumaCalendar(env.DB, calendarApiId);
        return calendar != null && canWriteGroup(identity, calendar);
      });
      if (result === "forbidden") return result;
      return {
        checkedIn: result === "checked_in",
        userId: null,
        reason: result === "failed" ? "failed" : null,
      };
    };
  } else {
    return Response.json({ error: "invalid_checkin_url" }, { status: 400 });
  }

  try {
    const result = await checkIn();
    if (result === "forbidden") return Response.json({ error: "forbidden" }, { status: 403 });
    const promoCode =
      result.checkedIn && result.userId ? await env.PROMO_USERS_KV.get(result.userId) : null;
    return Response.json({ ...result, promoCode });
  } catch (error) {
    console.error(connpassCheckin ? "connpass_checkin_failed" : "luma_checkin_failed", error);
    return Response.json({ checkedIn: false, userId: null, reason: "error", promoCode: null });
  }
}
