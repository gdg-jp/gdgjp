import type { AuthUser } from "@gdgjp/gdg-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";

const insertMock = vi.fn();
const sendMock = vi.fn();
const updateMock = vi.fn();

vi.mock("~/lib/db.server", () => ({
  getDb: () => ({
    insert: () => ({ values: insertMock }),
    update: () => ({ set: (values: unknown) => ({ where: () => updateMock(values) }) }),
  }),
}));

import { ALL_CHAPTERS, createSource } from "~/lib/sources.server";

const MEMBER = { id: "user-1", isAdmin: false } as AuthUser;
const ADMIN = { id: "user-2", isAdmin: true } as AuthUser;
const DOC_URL = "https://docs.google.com/document/d/abc123/edit";

function env(): Env {
  return { SOURCE_FETCH_QUEUE: { send: sendMock } } as unknown as Env;
}

beforeEach(() => {
  insertMock.mockReset().mockResolvedValue(undefined);
  sendMock.mockReset().mockResolvedValue(undefined);
  updateMock.mockReset().mockResolvedValue(undefined);
});

describe("createSource", () => {
  it("stores the chosen chapter and queues the fetch", async () => {
    const result = await createSource(env(), {
      url: DOC_URL,
      chapter: "chapter-osaka",
      user: MEMBER,
      chapterIds: ["chapter-osaka"],
    });

    expect(result.ok).toBe(true);
    expect(insertMock.mock.calls[0][0]).toMatchObject({
      chapterId: "chapter-osaka",
      addedBy: "user-1",
      kind: "google-doc",
      status: "pending",
    });
    expect(sendMock).toHaveBeenCalledWith({
      type: "source_fetch",
      sourceId: expect.any(String),
    });
  });

  it("refuses to default a missing chapter to everyone", async () => {
    // Raw material is unredacted, so a source readable by every member has to be an
    // explicit choice rather than the consequence of omitting a form field.
    const result = await createSource(env(), {
      url: DOC_URL,
      chapter: null,
      user: MEMBER,
      chapterIds: ["chapter-osaka"],
    });

    expect(result).toMatchObject({ ok: false, error: "chapter_required", status: 400 });
    expect(insertMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("accepts an explicit all-members scope", async () => {
    const result = await createSource(env(), {
      url: DOC_URL,
      chapter: ALL_CHAPTERS,
      user: MEMBER,
      chapterIds: ["chapter-osaka"],
    });

    expect(result.ok).toBe(true);
    expect(insertMock.mock.calls[0][0]).toMatchObject({ chapterId: null });
  });

  it("rejects a chapter the user does not belong to", async () => {
    const result = await createSource(env(), {
      url: DOC_URL,
      chapter: "chapter-tokyo",
      user: MEMBER,
      chapterIds: ["chapter-osaka"],
    });

    expect(result).toMatchObject({ ok: false, error: "forbidden_chapter", status: 403 });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("lets an admin assign any chapter", async () => {
    const result = await createSource(env(), {
      url: DOC_URL,
      chapter: "chapter-tokyo",
      user: ADMIN,
      chapterIds: [],
    });

    expect(result.ok).toBe(true);
    expect(insertMock.mock.calls[0][0]).toMatchObject({ chapterId: "chapter-tokyo" });
  });

  it("rejects an unusable URL before touching the database", async () => {
    const result = await createSource(env(), {
      url: "not-a-url",
      chapter: ALL_CHAPTERS,
      user: MEMBER,
      chapterIds: [],
    });

    expect(result).toMatchObject({ ok: false, error: "invalid_url", status: 400 });
    expect(insertMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("marks the row as error when the row is committed but the enqueue fails", async () => {
    sendMock.mockRejectedValue(new Error("queue unavailable"));

    const result = await createSource(env(), {
      url: DOC_URL,
      chapter: ALL_CHAPTERS,
      user: MEMBER,
      chapterIds: [],
    });

    // Left `pending`, a manual-policy source is never picked up again by the cron, so
    // the only recovery would be registering the same URL a second time.
    expect(result).toMatchObject({ ok: false, error: "enqueue_failed", status: 503 });
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
        errorMessage: expect.stringContaining("enqueue_failed"),
      }),
    );
  });
});
