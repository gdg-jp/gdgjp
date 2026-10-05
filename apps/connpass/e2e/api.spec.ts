import { expect, test } from "@playwright/test";
import { TOKENS, auth, uniqueGroupSlug, upsertGroup } from "./helpers";

test.describe("unauthenticated", () => {
  const getPaths = [
    "/api/admin/groups",
    "/api/jobs/missing",
    "/api/groups/gdg-tokyo/events",
    "/api/groups/gdg-tokyo/events/1",
    "/api/groups/gdg-tokyo/events/1/sub-events",
    "/api/groups/gdg-tokyo/events/1/sub-events/2",
    "/api/groups/gdg-tokyo/events/1/survey",
    "/api/groups/gdg-tokyo/events/1/conference",
  ];

  for (const path of getPaths) {
    test(`GET ${path} returns 401`, async ({ request }) => {
      const response = await request.get(path);
      expect(response.status()).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: "invalid_token" });
    });
  }

  test("POST mutations without a token return 401", async ({ request }) => {
    const create = await request.post("/api/groups/gdg-tokyo/events", {
      data: { title: "x" },
    });
    expect(create.status()).toBe(401);

    const relogin = await request.post("/api/admin/session/relogin");
    expect(relogin.status()).toBe(401);

    const upsert = await request.put("/api/admin/groups/gdg-tokyo", {
      data: { enabled: true },
    });
    expect(upsert.status()).toBe(401);
  });

  test("invalid bearer token returns 401", async ({ request }) => {
    const response = await request.get("/api/admin/groups", {
      headers: auth("not-a-real-token"),
    });
    expect(response.status()).toBe(401);
  });
});

test.describe("admin groups", () => {
  test("non-admin cannot list or upsert groups", async ({ request }) => {
    const list = await request.get("/api/admin/groups", { headers: auth(TOKENS.organizer) });
    expect(list.status()).toBe(403);

    const upsert = await request.put(`/api/admin/groups/${uniqueGroupSlug()}`, {
      headers: auth(TOKENS.member),
      data: { chapterId: "10", enabled: true },
    });
    expect(upsert.status()).toBe(403);
  });

  test("admin can upsert and list an allowlisted group", async ({ request }) => {
    const groupSlug = uniqueGroupSlug();
    const created = await upsertGroup(request, groupSlug, { numericGroupId: 4242 });
    expect(created).toMatchObject({
      groupId: groupSlug,
      numericGroupId: 4242,
      chapterId: "10",
      enabled: true,
    });

    const list = await request.get("/api/admin/groups", { headers: auth(TOKENS.admin) });
    expect(list.status()).toBe(200);
    const body = await list.json();
    expect(body.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ groupId: groupSlug, numericGroupId: 4242, enabled: true }),
      ]),
    );
  });
});

test.describe("authorization and validation (no connpass.com)", () => {
  test("unknown and disabled groups are forbidden", async ({ request }) => {
    const unknown = await request.get("/api/groups/does-not-exist/events", {
      headers: auth(TOKENS.admin),
    });
    expect(unknown.status()).toBe(403);

    const groupSlug = uniqueGroupSlug();
    await upsertGroup(request, groupSlug, { enabled: false });
    const disabled = await request.get(`/api/groups/${groupSlug}/events`, {
      headers: auth(TOKENS.admin),
    });
    expect(disabled.status()).toBe(403);
  });

  test("outsider cannot read a chapter group; member cannot write", async ({ request }) => {
    const groupSlug = uniqueGroupSlug();
    await upsertGroup(request, groupSlug);

    const outsider = await request.get(`/api/groups/${groupSlug}/events`, {
      headers: auth(TOKENS.outsider),
    });
    expect(outsider.status()).toBe(403);

    const create = await request.post(`/api/groups/${groupSlug}/events`, {
      headers: auth(TOKENS.member),
      data: { title: "should not enqueue" },
    });
    expect(create.status()).toBe(403);

    const publish = await request.post(`/api/groups/${groupSlug}/events/1/publish`, {
      headers: auth(TOKENS.member),
      data: {},
    });
    expect(publish.status()).toBe(403);

    const patch = await request.patch(`/api/groups/${groupSlug}/events/1`, {
      headers: auth(TOKENS.member),
      data: { title: "nope" },
    });
    expect(patch.status()).toBe(403);

    const subEvent = await request.post(`/api/groups/${groupSlug}/events/1/sub-events`, {
      headers: auth(TOKENS.member),
      data: { title: "nope" },
    });
    expect(subEvent.status()).toBe(403);

    const deleteSub = await request.delete(`/api/groups/${groupSlug}/events/1/sub-events/2`, {
      headers: auth(TOKENS.member),
    });
    expect(deleteSub.status()).toBe(403);

    const survey = await request.put(`/api/groups/${groupSlug}/events/1/survey`, {
      headers: auth(TOKENS.member),
      data: { questions: [] },
    });
    expect(survey.status()).toBe(403);

    const conference = await request.put(`/api/groups/${groupSlug}/events/1/conference`, {
      headers: auth(TOKENS.member),
      data: { isActive: true },
    });
    expect(conference.status()).toBe(403);
  });

  test("write endpoints reject invalid bodies before enqueueing", async ({ request }) => {
    const groupSlug = uniqueGroupSlug();
    await upsertGroup(request, groupSlug);

    const create = await request.post(`/api/groups/${groupSlug}/events`, {
      headers: auth(TOKENS.organizer),
      data: {},
    });
    expect(create.status()).toBe(400);
    await expect(create.json()).resolves.toEqual({ error: "title_required" });

    const subEvent = await request.post(`/api/groups/${groupSlug}/events/1/sub-events`, {
      headers: auth(TOKENS.organizer),
      data: { title: "   " },
    });
    expect(subEvent.status()).toBe(400);
    await expect(subEvent.json()).resolves.toEqual({ error: "title_required" });

    const survey = await request.put(`/api/groups/${groupSlug}/events/1/survey`, {
      headers: auth(TOKENS.organizer),
      data: { questions: [{ title: "Q", answerType: "unknown", required: true }] },
    });
    expect(survey.status()).toBe(400);
    await expect(survey.json()).resolves.toEqual({ error: "invalid_questions" });

    const conference = await request.put(`/api/groups/${groupSlug}/events/1/conference`, {
      headers: auth(TOKENS.organizer),
      data: { lpUrl: "https://example.com" },
    });
    expect(conference.status()).toBe(400);
    await expect(conference.json()).resolves.toEqual({ error: "invalid_body" });
  });

  test("jobs 404 and relogin is admin-only", async ({ request }) => {
    const missing = await request.get("/api/jobs/does-not-exist", {
      headers: auth(TOKENS.admin),
    });
    expect(missing.status()).toBe(404);

    const relogin = await request.post("/api/admin/session/relogin", {
      headers: auth(TOKENS.organizer),
    });
    expect(relogin.status()).toBe(403);
  });
});
