import { ensureLoggedIn, openConnpassSession } from "./browser.server";
import { scrapeEventDetail, scrapeGroupEvents } from "./connpass-ui/events";

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

export async function getEventInBrowser(env: Env, eventId: string | number) {
  const session = await openConnpassSession(env);
  try {
    await ensureLoggedIn(env, session);
    const event = await scrapeEventDetail(session.page, eventId);
    await session.persist();
    return event;
  } finally {
    await session.close();
  }
}
