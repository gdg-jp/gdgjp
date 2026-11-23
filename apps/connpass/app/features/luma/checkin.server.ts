import type { LumaCheckinUrl } from "./checkin-url";
import { LumaApiError, type LumaClient, lumaClient } from "./client.server";

const EVENT_CALENDAR_TTL_SECONDS = 24 * 60 * 60;

type LumaGuest = {
  api_id: string;
  approval_status: string;
  last_checked_in_at: string | null;
};

function isLumaStatus(error: unknown, ...statuses: number[]): boolean {
  return error instanceof LumaApiError && statuses.includes(error.status);
}

async function eventCalendarApiId(
  env: Env,
  luma: LumaClient,
  eventApiId: string,
): Promise<string | null> {
  const cacheKey = `luma:event-calendar:${eventApiId}`;
  const cached = await env.SESSION_KV.get(cacheKey);
  if (cached) return cached;
  let calendarApiId: string | undefined;
  try {
    const { event } = await luma.get<{ event?: { calendar_api_id?: string } }>("/event/admin/get", {
      event_api_id: eventApiId,
    });
    calendarApiId = event?.calendar_api_id;
  } catch (error) {
    if (isLumaStatus(error, 400, 403, 404)) return null;
    throw error;
  }
  if (!calendarApiId) return null;
  await env.SESSION_KV.put(cacheKey, calendarApiId, { expirationTtl: EVENT_CALENDAR_TTL_SECONDS });
  return calendarApiId;
}

export async function checkInLumaGuest(
  env: Env,
  checkin: LumaCheckinUrl,
  authorize: (calendarApiId: string) => Promise<boolean>,
): Promise<"checked_in" | "failed" | "forbidden"> {
  const luma = lumaClient(env);
  const calendarApiId = await eventCalendarApiId(env, luma, checkin.eventApiId);
  if (!calendarApiId || !(await authorize(calendarApiId))) return "forbidden";

  let guest: LumaGuest;
  try {
    ({ guest } = await luma.get<{ guest: LumaGuest }>("/event/admin/get-guest", {
      event_api_id: checkin.eventApiId,
      proxy_key: checkin.proxyKey,
    }));
  } catch (error) {
    if (isLumaStatus(error, 400, 404)) return "failed";
    throw error;
  }
  if (guest.approval_status !== "approved") return "failed";

  const { guest: updated } = await luma.post<{ guest: LumaGuest }>("/event/admin/update-check-in", {
    event_api_id: checkin.eventApiId,
    check_in_method: "scanner",
    check_in_status: "checked-in",
    type: "guest",
    rsvp_api_id: guest.api_id,
  });
  return updated.last_checked_in_at ? "checked_in" : "failed";
}
