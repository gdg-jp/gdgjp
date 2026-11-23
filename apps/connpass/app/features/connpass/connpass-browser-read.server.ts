import type { Page } from "@cloudflare/playwright";
import { getAllowedGroupByNumericId } from "../auth/authorize.server";
import { ensureLoggedIn, forceRelogin, openConnpassSession } from "./browser.server";
import { type CheckinResult, checkInWithQrUrl } from "./ui/checkin";
import { scrapeConference } from "./ui/conference";
import { type ScrapedEventDetail, scrapeEventDetail, scrapeGroupEvents } from "./ui/event-read";
import { scrapeEventStatistics, scrapeParticipants } from "./ui/participants";
import { scrapeSubEvents } from "./ui/sub-events";
import { scrapeSurvey } from "./ui/survey";
import { scrapeVoucherRecipients } from "./ui/vouchers";

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
        } catch {}
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

export function checkInInBrowser(env: Env, checkinUrl: string): Promise<CheckinResult> {
  return withConnpassRead(env, (page) => checkInWithQrUrl(page, checkinUrl));
}
