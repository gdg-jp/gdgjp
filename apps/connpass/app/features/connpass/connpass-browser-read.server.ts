import type { Page } from "@cloudflare/playwright";
import { getAllowedGroupByNumericId } from "../auth/authorize.server";
import { ensureLoggedIn, forceRelogin, openConnpassSession } from "./browser.server";
import { checkInWithQrUrl, scrapeEventGroupNumericId } from "./ui/checkin";
import { scrapeConference } from "./ui/conference";
import { type ScrapedEventDetail, scrapeEventDetail, scrapeGroupEvents } from "./ui/event-read";
import { scrapeEventStatistics, scrapeParticipants } from "./ui/participants";
import { scrapeSubEvents } from "./ui/sub-events";
import { scrapeSurvey } from "./ui/survey";
import { scrapeVoucherRecipients } from "./ui/vouchers";

/**
 * Run a connpass.com read against a browser session, reusing a warm session when
 * one is available. Reads have no queue behind them, so if the (possibly skipped)
 * auth pre-check let a dead-cookie session through and the scrape hits a login
 * wall, retry once after a forced relogin.
 */
async function withConnpassRead<T>(env: Env, fn: (page: Page) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const session = await openConnpassSession(env);
    let poisoned = false;
    try {
      await ensureLoggedIn(env, session);
      const out = await fn(session.page);
      await session.persist();
      return out;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const authish = message.includes("login") || session.page.url().includes("/login");
      if (authish && attempt === 0) {
        poisoned = true;
        try {
          await forceRelogin(env);
        } catch {
          // fall through and retry anyway
        }
        continue;
      }
      throw error;
    } finally {
      if (poisoned) await session.destroy();
      else await session.release();
    }
  }
  throw new Error("connpass_read_unreachable");
}

export function listGroupEventsInBrowser(env: Env, groupSlug: string) {
  return withConnpassRead(env, (page) => scrapeGroupEvents(page, groupSlug));
}

export type EventDetailWithGroup = Omit<ScrapedEventDetail, "groupNumericId"> & {
  groupId: string | null;
};

export function getEventInBrowser(
  env: Env,
  eventId: string | number,
): Promise<EventDetailWithGroup> {
  return withConnpassRead(env, async (page) => {
    const { groupNumericId, ...rest } = await scrapeEventDetail(page, eventId);
    const group =
      groupNumericId != null ? await getAllowedGroupByNumericId(env.DB, groupNumericId) : null;
    return { ...rest, groupId: group?.groupSlug ?? null };
  });
}

export function listSubEventsInBrowser(env: Env, eventId: string | number) {
  return withConnpassRead(env, (page) => scrapeSubEvents(page, eventId));
}

export function getSurveyInBrowser(env: Env, eventId: string | number) {
  return withConnpassRead(env, (page) => scrapeSurvey(page, eventId));
}

export function getConferenceInBrowser(env: Env, eventId: string | number) {
  return withConnpassRead(env, (page) => scrapeConference(page, eventId));
}

export function getParticipantsInBrowser(env: Env, eventId: string | number) {
  return withConnpassRead(env, (page) => scrapeParticipants(page, String(eventId)));
}

export function getEventStatisticsInBrowser(env: Env, eventId: string | number) {
  return withConnpassRead(env, (page) => scrapeEventStatistics(page, String(eventId)));
}

export function getVoucherRecipientsInBrowser(env: Env, eventId: string | number) {
  return withConnpassRead(env, (page) => scrapeVoucherRecipients(page, String(eventId)));
}

const EVENT_GROUP_TTL_SECONDS = 24 * 60 * 60;

/**
 * Reception check-in is synchronous: staff scan one QR after another and need the
 * result immediately. The event's group is resolved first (KV-cached so repeated
 * scans cost one page load) and `authorize` must approve it before the QR URL is
 * opened, because opening it is what records attendance.
 */
export function checkInInBrowser(
  env: Env,
  checkin: { url: string; eventId: string },
  authorize: (groupNumericId: number) => Promise<boolean>,
): Promise<"checked_in" | "failed" | "forbidden"> {
  const cacheKey = `connpass:event-group:${checkin.eventId}`;
  return withConnpassRead(env, async (page) => {
    let groupNumericId = Number((await env.SESSION_KV.get(cacheKey)) ?? Number.NaN);
    if (!Number.isFinite(groupNumericId)) {
      const scraped = await scrapeEventGroupNumericId(page, checkin.eventId);
      if (scraped == null) return "forbidden";
      groupNumericId = scraped;
      await env.SESSION_KV.put(cacheKey, String(scraped), {
        expirationTtl: EVENT_GROUP_TTL_SECONDS,
      });
    }
    if (!(await authorize(groupNumericId))) return "forbidden";
    return (await checkInWithQrUrl(page, checkin.url)) ? "checked_in" : "failed";
  });
}
