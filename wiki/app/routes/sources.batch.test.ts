import { beforeEach, describe, expect, it, vi } from "vitest";

const createSourceMock = vi.fn();

vi.mock("~/lib/auth-utils.server", () => ({
  getAccessIdentity: vi.fn().mockResolvedValue({ chapterIds: ["chapter-osaka"] }),
  requireUser: vi.fn().mockResolvedValue({ id: "user-1", isAdmin: false }),
}));

vi.mock("~/lib/sources.server", () => ({
  canAccessSource: vi.fn(),
  createSource: (...args: unknown[]) => createSourceMock(...args),
  deleteArchivedSource: vi.fn(),
  enqueueSourceRefresh: vi.fn(),
  unarchiveSource: vi.fn(),
}));

import { action } from "./sources";

function requestArgs(candidates: unknown, chapter = "chapter-osaka") {
  const form = new FormData();
  form.set("intent", "create-batch");
  form.set("chapter", chapter);
  form.set("candidates", JSON.stringify(candidates));
  const request = new Request("http://localhost/sources", { method: "POST", body: form });
  return {
    request,
    context: { cloudflare: { env: {} } } as never,
    params: {},
    unstable_pattern: "/sources",
    unstable_url: new URL(request.url),
  };
}

describe("sources batch action", () => {
  beforeEach(() => createSourceMock.mockReset());

  it("registers mixed Drive and Chat candidates with one shared scope", async () => {
    createSourceMock.mockResolvedValue({ ok: true });
    const result = await action(
      requestArgs([
        {
          id: "drive:doc-1",
          kind: "google-drive",
          title: "Document",
          url: "https://docs.google.com/document/d/doc-1/edit",
        },
        {
          id: "chat:spaces/abc",
          kind: "google-chat-space",
          title: "Chat",
          url: "https://mail.google.com/chat/u/0/#chat/space/abc",
          externalId: "spaces/abc",
        },
      ]),
    );

    expect(result).toEqual({ ok: true, addedIds: ["drive:doc-1", "chat:spaces/abc"], failed: [] });
    expect(createSourceMock).toHaveBeenNthCalledWith(
      1,
      expect.any(Object),
      expect.objectContaining({
        url: "https://docs.google.com/document/d/doc-1/edit",
        chapter: "chapter-osaka",
      }),
    );
    expect(createSourceMock).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      expect.objectContaining({
        kind: "google-chat-space",
        externalId: "spaces/abc",
        chapter: "chapter-osaka",
      }),
    );
  });

  it("keeps only unregistered failures for retry and removes queue-failed sources", async () => {
    createSourceMock
      .mockResolvedValueOnce({ ok: false, error: "invalid_url" })
      .mockResolvedValueOnce({ ok: false, error: "enqueue_failed" });

    const result = await action(
      requestArgs([
        {
          id: "drive:bad",
          kind: "google-drive",
          title: "Bad",
          url: "not-a-url",
        },
        {
          id: "drive:queued",
          kind: "google-drive",
          title: "Queued",
          url: "https://docs.google.com/document/d/queued/edit",
        },
      ]),
    );

    expect(result).toEqual({
      ok: true,
      addedIds: ["drive:queued"],
      failed: [{ id: "drive:bad", error: "invalid_url" }],
    });
  });

  it("rejects malformed or duplicate candidates before creating a source", async () => {
    const result = await action(
      requestArgs([
        { id: "drive:one", kind: "google-drive", title: "One", url: "https://example.com" },
        { id: "drive:one", kind: "google-drive", title: "Two", url: "https://example.com" },
      ]),
    );

    expect(result).toEqual({ ok: false, error: "invalid_batch" });
    expect(createSourceMock).not.toHaveBeenCalled();
  });
});
