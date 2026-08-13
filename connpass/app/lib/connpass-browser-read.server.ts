import { getAllowedGroupByNumericId } from "./authorize.server";
import { ensureLoggedIn, openConnpassSession } from "./browser.server";
import { scrapeConference } from "./connpass-ui/conference";
import {
  type ScrapedEventDetail,
  scrapeEventDetail,
  scrapeGroupEvents,
  scrapeSubEvents,
} from "./connpass-ui/events";
import { scrapeSurvey } from "./connpass-ui/survey";

export async function listGroupEventsInBrowser(env: Env, groupSlug: string) {
  const session = await openConnpassSession(env);
  try {
    await ensureLoggedIn(env, session);
    const events = await scrapeGroupEvents(session.page, groupSlug);
    await session.persist();
    return events;
  } finally {
    await session.close();
  }
}

export type EventDetailWithGroup = Omit<ScrapedEventDetail, "groupNumericId"> & {
  groupId: string | null;
};

export async function getEventInBrowser(
  env: Env,
  eventId: string | number,
): Promise<EventDetailWithGroup> {
  const session = await openConnpassSession(env);
  try {
    await ensureLoggedIn(env, session);
    const { groupNumericId, ...rest } = await scrapeEventDetail(session.page, eventId);
    await session.persist();
    const group =
      groupNumericId != null ? await getAllowedGroupByNumericId(env.DB, groupNumericId) : null;
    return { ...rest, groupId: group?.groupSlug ?? null };
  } finally {
    await session.close();
  }
}

export async function listSubEventsInBrowser(env: Env, eventId: string | number) {
  const session = await openConnpassSession(env);
  try {
    await ensureLoggedIn(env, session);
    const subEvents = await scrapeSubEvents(session.page, eventId);
    await session.persist();
    return subEvents;
  } finally {
    await session.close();
  }
}

export async function getSurveyInBrowser(env: Env, eventId: string | number) {
  const session = await openConnpassSession(env);
  try {
    await ensureLoggedIn(env, session);
    const survey = await scrapeSurvey(session.page, eventId);
    await session.persist();
    return survey;
  } finally {
    await session.close();
  }
}

export async function getConferenceInBrowser(env: Env, eventId: string | number) {
  const session = await openConnpassSession(env);
  try {
    await ensureLoggedIn(env, session);
    const conference = await scrapeConference(session.page, eventId);
    await session.persist();
    return conference;
  } finally {
    await session.close();
  }
}
