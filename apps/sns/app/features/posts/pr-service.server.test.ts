import type { PrActor } from "@gdgjp/gdg-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";

const canPost = vi.fn();
const createDraft = vi.fn();
const getDraft = vi.fn();

vi.mock("~/features/auth/rpc-access.server", () => ({
  canPostForChapter: (...args: unknown[]) => canPost(...args),
}));
vi.mock("~/features/x-accounts/x-account.repository.server", () => ({
  listXAccounts: async () => [{ id: "xa", username: "gdgkwansai", displayName: "GDG" }],
}));
vi.mock("./post-draft.deps.server", () => ({ postDraftDepsFromEnv: () => ({}) }));
vi.mock("./post-draft.service.server", async () => {
  class PostDraftError extends Error {
    constructor(
      readonly code: string,
      message?: string,
    ) {
      super(message ?? code);
    }
  }
  return {
    PostDraftError,
    createDraft: (...args: unknown[]) => createDraft(...args),
    getDraft: (...args: unknown[]) => getDraft(...args),
    updateDraft: vi.fn(),
    attachMedia: vi.fn(),
  };
});

const { prCreateScheduledPost, prGetPost, prListXAccounts } = await import("./pr-service.server");
const { PostDraftError } = await import("./post-draft.service.server");

const env = { DB: {} } as Env;
const actor: PrActor = {
  user: { id: "u1", email: "u@example.com", name: "u", image: null, isAdmin: false },
  chapters: [{ chapterId: 1, chapterSlug: "kwansai", role: "organizer" }],
};
const input = {
  actor,
  chapterId: 1,
  xAccountId: "xa",
  text: "hi",
  scheduledAt: "2026-12-01T09:00:00.000Z",
  condition: "scheduled" as const,
};
const post = {
  id: "p1",
  chapterId: 1,
  status: "scheduled",
  scheduledAt: input.scheduledAt,
  publishedXPostId: null,
  failureReason: null,
};

beforeEach(() => {
  canPost.mockReset();
  createDraft.mockReset();
  getDraft.mockReset();
});

describe("sns PrService", () => {
  it("refuses an actor who may not post for the chapter", async () => {
    canPost.mockResolvedValue(false);
    expect(await prCreateScheduledPost(env, input)).toEqual({ ok: false, code: "forbidden" });
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("schedules through createDraft as the actor", async () => {
    canPost.mockResolvedValue(true);
    createDraft.mockResolvedValue(post);
    const result = await prCreateScheduledPost(env, input);
    expect(result).toMatchObject({ ok: true, post: { id: "p1", status: "scheduled" } });
    expect(createDraft.mock.calls[0][1]).toMatchObject({ createdByUserId: "u1", chapterId: 1 });
  });

  it("maps PostDraftError codes instead of throwing", async () => {
    canPost.mockResolvedValue(true);
    createDraft.mockRejectedValue(new PostDraftError("invalid_schedule" as never, "past"));
    expect(await prCreateScheduledPost(env, input)).toEqual({
      ok: false,
      code: "invalid_schedule",
      message: "past",
    });
  });

  it("hides another chapter's post", async () => {
    canPost.mockResolvedValue(true);
    getDraft.mockResolvedValue({ post: { ...post, chapterId: 2 } });
    expect(await prGetPost(env, { actor, chapterId: 1, postId: "p1" })).toEqual({
      ok: false,
      code: "not_found",
    });
  });

  it("reports whether the actor can post alongside the accounts", async () => {
    canPost.mockResolvedValue(false);
    expect(await prListXAccounts(env, { actor, chapterId: 1 })).toMatchObject({
      ok: true,
      canPost: false,
      accounts: [{ id: "xa", username: "gdgkwansai" }],
    });
  });
});
