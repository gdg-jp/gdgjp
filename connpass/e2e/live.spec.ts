import { expect, test } from "@playwright/test";
import { TOKENS, auth, liveConfig, upsertGroup, waitForJob } from "./helpers";

const live = liveConfig();

test.describe("live connpass.com", () => {
  test.describe.configure({ timeout: 180_000 });

  test.skip(!live.enabled, "set CONNPASS_E2E_LIVE=1 with CONNPASS_BOT_EMAIL/PASSWORD in .dev.vars");

  test("admin relogin job succeeds against connpass.com", async ({ request }) => {
    const accepted = await request.post("/api/admin/session/relogin", {
      headers: auth(TOKENS.admin),
    });
    expect(accepted.status(), await accepted.text()).toBe(202);
    const job = await accepted.json();
    expect(job).toMatchObject({ type: "relogin", status: "queued", groupId: "_system" });

    const finished = await waitForJob(request, job.id);
    expect(finished.status, finished.error ?? "").toBe("succeeded");
  });

  test("GET group events scrapes the allowlisted group", async ({ request }) => {
    test.skip(!live.groupSlug, "set CONNPASS_E2E_GROUP_SLUG to a group the bot can administer");
    const groupSlug = live.groupSlug as string;
    await upsertGroup(request, groupSlug);

    const response = await request.get(`/api/groups/${groupSlug}/events`, {
      headers: auth(TOKENS.admin),
    });
    expect(response.status(), await response.text()).toBe(200);
    const body = await response.json();
    expect(body.groupId).toBe(groupSlug);
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.resultsReturned).toBe(body.events.length);
  });

  test("GET event, survey, conference, and sub-events", async ({ request }) => {
    test.skip(
      !live.groupSlug || !live.eventId,
      "set CONNPASS_E2E_GROUP_SLUG and CONNPASS_E2E_EVENT_ID",
    );
    const groupSlug = live.groupSlug as string;
    const eventId = live.eventId as string;
    await upsertGroup(request, groupSlug);

    const event = await request.get(`/api/groups/${groupSlug}/events/${eventId}`, {
      headers: auth(TOKENS.admin),
    });
    expect(event.status(), await event.text()).toBe(200);
    const eventBody = await event.json();
    expect(eventBody.event).toMatchObject({ id: expect.anything() });

    const survey = await request.get(`/api/groups/${groupSlug}/events/${eventId}/survey`, {
      headers: auth(TOKENS.admin),
    });
    expect(survey.status(), await survey.text()).toBe(200);
    await expect(survey.json()).resolves.toMatchObject({
      groupId: groupSlug,
      eventId,
      survey: { questions: expect.any(Array) },
    });

    const conference = await request.get(`/api/groups/${groupSlug}/events/${eventId}/conference`, {
      headers: auth(TOKENS.admin),
    });
    expect(conference.status(), await conference.text()).toBe(200);
    await expect(conference.json()).resolves.toMatchObject({
      groupId: groupSlug,
      eventId,
      conference: { isActive: expect.any(Boolean) },
    });

    const subEvents = await request.get(`/api/groups/${groupSlug}/events/${eventId}/sub-events`, {
      headers: auth(TOKENS.admin),
    });
    expect(subEvents.status(), await subEvents.text()).toBe(200);
    const subBody = await subEvents.json();
    expect(subBody.subEvents).toEqual(expect.any(Array));

    if (subBody.subEvents[0]?.id) {
      const one = await request.get(
        `/api/groups/${groupSlug}/events/${eventId}/sub-events/${subBody.subEvents[0].id}`,
        { headers: auth(TOKENS.admin) },
      );
      expect(one.status(), await one.text()).toBe(200);
    }
  });

  test("create draft job completes when live writes are enabled", async ({ request }) => {
    test.skip(
      !live.liveWrites || !live.groupSlug,
      "set CONNPASS_E2E_LIVE_WRITES=1 and CONNPASS_E2E_GROUP_SLUG",
    );
    const groupSlug = live.groupSlug as string;
    await upsertGroup(request, groupSlug);
    const title = `[e2e] ${new Date().toISOString()}`;

    const accepted = await request.post(`/api/groups/${groupSlug}/events`, {
      headers: auth(TOKENS.admin),
      data: { title, description: "Created by connpass API e2e; leave unpublished." },
    });
    expect(accepted.status(), await accepted.text()).toBe(202);
    const job = await accepted.json();
    expect(job).toMatchObject({ type: "create_event", status: "queued" });

    const finished = await waitForJob(request, job.id);
    expect(finished.status, finished.error ?? "").toBe("succeeded");
    expect(finished.eventId).toBeTruthy();
  });
});
