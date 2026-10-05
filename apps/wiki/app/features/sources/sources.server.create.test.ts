import type { AuthUser } from "@gdgjp/gdg-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";

const insertMock = vi.fn();
const sendMock = vi.fn();
const updateMock = vi.fn();
const findExistingMock = vi.fn();

vi.mock("~/lib/db.server", () => ({
  getDb: () => ({
    insert: () => ({ values: insertMock }),
    update: () => ({ set: (values: unknown) => ({ where: () => updateMock(values) }) }),
    select: () => ({
      from: () => ({
        where: () => ({
          get: findExistingMock,
        }),
      }),
    }),
  }),
}));

import { createSource } from "~/features/sources/sources.server";

const MEMBER = { id: "user-1", isAdmin: false } as AuthUser;
const ADMIN = { id: "user-2", isAdmin: true } as AuthUser;
const DOC_URL = "https://docs.google.com/document/d/abc123/edit";
const OSAKA = { chapterId: "chapter-osaka", role: "member" };

function env(): Env {
  return { SOURCE_FETCH_QUEUE: { send: sendMock } } as unknown as Env;
}

beforeEach(() => {
  insertMock.mockReset().mockResolvedValue(undefined);
  sendMock.mockReset().mockResolvedValue(undefined);
  updateMock.mockReset().mockResolvedValue(undefined);
  findExistingMock.mockReset().mockResolvedValue(undefined);
});

describe("createSource", () => {
  it("stores the chosen chapter visibility and queues the fetch", async () => {
    const result = await createSource(env(), {
      url: DOC_URL,
      visibility: "chapter-member",
      chapter: "chapter-osaka",
      user: MEMBER,
      chapters: [OSAKA],
    });

    expect(result.ok).toBe(true);
    expect(insertMock.mock.calls[0][0]).toMatchObject({
      chapterId: "chapter-osaka",
      visibility: "chapter-member",
      addedBy: "user-1",
      kind: "google-doc",
      status: "pending",
    });
    expect(sendMock).toHaveBeenCalledWith({
      type: "source_fetch",
      sourceId: expect.any(String),
    });
  });

  it("stores chapter-organizer with an Accounts chapter id (no local chapters row required)", async () => {
    const result = await createSource(env(), {
      url: DOC_URL,
      visibility: "chapter-organizer",
      chapter: "accounts-chapter-1",
      user: MEMBER,
      chapters: [{ chapterId: "accounts-chapter-1", role: "organizer" }],
    });

    expect(result.ok).toBe(true);
    expect(insertMock.mock.calls[0][0]).toMatchObject({
      chapterId: "accounts-chapter-1",
      visibility: "chapter-organizer",
    });
  });

  it("refuses to default a missing visibility to everyone", async () => {
    const result = await createSource(env(), {
      url: DOC_URL,
      visibility: null,
      chapter: null,
      user: MEMBER,
      chapters: [OSAKA],
    });

    expect(result).toMatchObject({ ok: false, error: "invalid_visibility", status: 400 });
    expect(insertMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("accepts an explicit all-members scope", async () => {
    const result = await createSource(env(), {
      url: DOC_URL,
      visibility: "member",
      chapter: null,
      user: MEMBER,
      chapters: [OSAKA],
    });

    expect(result.ok).toBe(true);
    expect(insertMock.mock.calls[0][0]).toMatchObject({
      chapterId: null,
      visibility: "member",
    });
  });

  it("rejects a chapter the user does not belong to", async () => {
    const result = await createSource(env(), {
      url: DOC_URL,
      visibility: "chapter-member",
      chapter: "chapter-tokyo",
      user: MEMBER,
      chapters: [OSAKA],
    });

    expect(result).toMatchObject({ ok: false, error: "forbidden_chapter", status: 403 });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("lets an admin assign any chapter", async () => {
    const result = await createSource(env(), {
      url: DOC_URL,
      visibility: "chapter-member",
      chapter: "chapter-tokyo",
      user: ADMIN,
      chapters: [],
    });

    expect(result.ok).toBe(true);
    expect(insertMock.mock.calls[0][0]).toMatchObject({
      chapterId: "chapter-tokyo",
      visibility: "chapter-member",
    });
  });

  it("rejects an unusable URL before touching the database", async () => {
    const result = await createSource(env(), {
      url: "not-a-url",
      visibility: "member",
      chapter: null,
      user: MEMBER,
      chapters: [],
    });

    expect(result).toMatchObject({ ok: false, error: "invalid_url", status: 400 });
    expect(insertMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("rejects a Drive file that is already registered", async () => {
    findExistingMock.mockResolvedValue({ id: "existing-source" });

    const result = await createSource(env(), {
      url: DOC_URL,
      visibility: "member",
      chapter: null,
      user: MEMBER,
      chapters: [],
    });

    expect(result).toMatchObject({ ok: false, error: "duplicate_source", status: 409 });
    expect(insertMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("rejects a website URL that is already registered", async () => {
    findExistingMock.mockResolvedValue({ id: "existing-website" });

    const result = await createSource(env(), {
      url: "https://example.com/page",
      visibility: "member",
      chapter: null,
      user: MEMBER,
      chapters: [],
    });

    expect(result).toMatchObject({ ok: false, error: "duplicate_source", status: 409 });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("rejects a Chat space that is already registered", async () => {
    findExistingMock.mockResolvedValue({ id: "existing-chat" });

    const result = await createSource(env(), {
      kind: "google-chat-space",
      externalId: "spaces/abc",
      title: "Chat",
      visibility: "member",
      chapter: null,
      user: MEMBER,
      chapters: [],
    });

    expect(result).toMatchObject({ ok: false, error: "duplicate_source", status: 409 });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("marks the row as error when the row is committed but the enqueue fails", async () => {
    sendMock.mockRejectedValue(new Error("queue unavailable"));

    const result = await createSource(env(), {
      url: DOC_URL,
      visibility: "member",
      chapter: null,
      user: MEMBER,
      chapters: [],
    });

    expect(result).toMatchObject({ ok: false, error: "enqueue_failed", status: 503 });
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
        errorMessage: expect.stringContaining("enqueue_failed"),
      }),
    );
  });
});
