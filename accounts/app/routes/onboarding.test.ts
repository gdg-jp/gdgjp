import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUser = vi.fn();
const listChapters = vi.fn();
const listMembershipsForUser = vi.fn();
const requestMembership = vi.fn();
const getChapterById = vi.fn();
const getOrganizerEmailsForChapter = vi.fn();
const bustChaptersWithCountsCache = vi.fn();
const sendJoinRequestSubmitted = vi.fn();
const getFixedT = vi.fn(async () => (key: string) => key);
const getLocale = vi.fn(async () => "en");

vi.mock("~/lib/auth.server", () => ({ requireUser }));
vi.mock("~/lib/db", () => ({
  listChapters,
  listMembershipsForUser,
  requestMembership,
  getChapterById,
  getOrganizerEmailsForChapter,
  bustChaptersWithCountsCache,
}));
vi.mock("~/lib/email.server", () => ({ sendJoinRequestSubmitted }));
vi.mock("~/lib/i18n/i18n.server", () => ({
  i18n: { getFixedT, getLocale },
}));

describe("onboarding action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({
      id: "u1",
      email: "u@example.com",
      name: "User",
      isAdmin: false,
    });
    getChapterById.mockImplementation(async (_db: unknown, id: number) => {
      if (id === 2) {
        return {
          id: 2,
          slug: "gdg-tokyo",
          name: "GDG Tokyo",
          kind: "gdg",
          region: "kanto",
          createdAt: 1,
        };
      }
      if (id === 15) {
        return {
          id: 15,
          slug: "gdg-osaka",
          name: "GDG Osaka",
          kind: "gdg",
          region: "kansai",
          createdAt: 1,
        };
      }
      return null;
    });
    requestMembership.mockResolvedValue({ ok: true });
    getOrganizerEmailsForChapter.mockResolvedValue(["org@example.com"]);
    bustChaptersWithCountsCache.mockResolvedValue(undefined);
  });

  it("requests membership for multiple chapter ids", async () => {
    const { action } = await import("./onboarding");
    const form = new FormData();
    form.set("intent", "request");
    form.append("chapterId", "2");
    form.append("chapterId", "15");
    const result = await action({
      request: new Request("https://accounts.example/onboarding", {
        method: "POST",
        body: form,
      }),
      context: {
        cloudflare: {
          env: { DB: {} },
          ctx: { waitUntil: vi.fn() },
        },
      },
      params: {},
    } as never);

    expect(requestMembership).toHaveBeenCalledTimes(2);
    expect(sendJoinRequestSubmitted).toHaveBeenCalledTimes(2);
    // data() wraps the payload
    const payload =
      result && typeof result === "object" && "data" in result
        ? (result as { data: unknown }).data
        : result;
    expect(payload).toEqual({
      ok: true,
      intent: "request",
      chapterIds: [2, 15],
    });
  });

  it("treats already_in_chapter as accepted without email", async () => {
    requestMembership
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, reason: "already_in_chapter" });
    const { action } = await import("./onboarding");
    const form = new FormData();
    form.set("intent", "request");
    form.append("chapterId", "2");
    form.append("chapterId", "15");
    const result = await action({
      request: new Request("https://accounts.example/onboarding", {
        method: "POST",
        body: form,
      }),
      context: {
        cloudflare: {
          env: { DB: {} },
          ctx: { waitUntil: vi.fn() },
        },
      },
      params: {},
    } as never);
    const payload =
      result && typeof result === "object" && "data" in result
        ? (result as { data: unknown }).data
        : result;
    expect(payload).toEqual({
      ok: true,
      intent: "request",
      chapterIds: [2, 15],
    });
    expect(sendJoinRequestSubmitted).toHaveBeenCalledTimes(1);
  });

  it("rejects hidden demo chapters", async () => {
    getChapterById.mockResolvedValue({
      id: 37,
      slug: "demo",
      name: "Demo Group",
      kind: "gdg",
      region: "other",
      createdAt: 1,
    });
    const { action } = await import("./onboarding");
    const form = new FormData();
    form.set("intent", "request");
    form.append("chapterId", "37");
    const result = await action({
      request: new Request("https://accounts.example/onboarding", {
        method: "POST",
        body: form,
      }),
      context: {
        cloudflare: {
          env: { DB: {} },
          ctx: { waitUntil: vi.fn() },
        },
      },
      params: {},
    } as never);
    expect(result).toEqual({ error: "errors.chapterNotFound" });
    expect(requestMembership).not.toHaveBeenCalled();
  });
});
