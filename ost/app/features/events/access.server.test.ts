import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireEventAccess } from "./access.server";

const mocks = vi.hoisted(() => ({ membership: vi.fn(), event: vi.fn() }));
vi.mock("~/features/auth/access.server", () => ({ requireUserWithChapter: mocks.membership }));
vi.mock("./events.server", () => ({ getEventBySlug: mocks.event }));
const env = { DB: {} } as Env;
const request = new Request("https://ost.gdgs.jp/test-event/edit");
const user = { id: "owner" };
const event = { slug: "test-event", chapterId: 1 };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.membership.mockResolvedValue({ user, chapters: [{ chapterId: 1 }] });
  mocks.event.mockResolvedValue(event);
});

describe("event ownership policy", () => {
  it("rejects invalid slugs before looking up membership or storage", async () => {
    await expect(requireEventAccess(env, request, "signin")).rejects.toMatchObject({ status: 404 });
    expect(mocks.membership).not.toHaveBeenCalled();
    expect(mocks.event).not.toHaveBeenCalled();
  });

  it("propagates the session gate before touching event storage", async () => {
    const redirect = new Response(null, { status: 302 });
    mocks.membership.mockRejectedValue(redirect);
    await expect(requireEventAccess(env, request, "test-event")).rejects.toBe(redirect);
    expect(mocks.event).not.toHaveBeenCalled();
  });

  it("rejects missing and foreign-chapter events", async () => {
    mocks.event.mockResolvedValue(null);
    await expect(requireEventAccess(env, request, "test-event")).rejects.toMatchObject({
      status: 404,
    });
    mocks.event.mockResolvedValue({ ...event, chapterId: 2 });
    await expect(requireEventAccess(env, request, "test-event")).rejects.toMatchObject({
      status: 403,
    });
  });

  it("allows the owning chapter among multiple memberships", async () => {
    const chapters = [{ chapterId: 2 }, { chapterId: 1 }];
    mocks.membership.mockResolvedValue({ user, chapters });
    await expect(requireEventAccess(env, request, "test-event")).resolves.toEqual({
      user,
      chapters,
      event,
    });
    expect(mocks.event).toHaveBeenCalledWith(env.DB, "test-event");
  });
});
