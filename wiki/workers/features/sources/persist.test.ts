import { beforeEach, describe, expect, it, vi } from "vitest";

const getMock = vi.fn();
const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();
const putMock = vi.fn();

vi.mock("../../../app/lib/db.server", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          get: getMock,
        }),
      }),
    }),
    insert: () => ({
      values: insertMock,
    }),
    update: () => ({
      set: () => ({
        where: updateMock,
      }),
    }),
    delete: () => ({
      where: deleteMock,
    }),
  }),
}));

vi.mock("nanoid", () => ({ nanoid: () => "doc-fixed-id" }));

import { contentR2Key, persistSourceDocument, sha256Hex } from "./persist";

describe("persistSourceDocument", () => {
  beforeEach(() => {
    getMock.mockReset();
    insertMock.mockReset();
    updateMock.mockReset();
    deleteMock.mockReset();
    putMock.mockReset();
    insertMock.mockResolvedValue(undefined);
    updateMock.mockResolvedValue(undefined);
    deleteMock.mockResolvedValue(undefined);
    putMock.mockResolvedValue(undefined);
  });

  it("skips R2 write when content_hash is unchanged", async () => {
    const markdown = "# Hello";
    const hash = await sha256Hex(new TextEncoder().encode(markdown));
    getMock.mockResolvedValue({
      id: "doc-1",
      path: "index",
      contentHash: hash,
      r2Key: `raw/src-1/doc-1/${hash}.md`,
      status: "ready",
    });

    const env = { BUCKET: { put: putMock } } as unknown as Env;
    const result = await persistSourceDocument(env, {
      sourceId: "src-1",
      path: "index",
      title: "Hello",
      markdown,
    });

    expect(result.written).toBe(false);
    expect(result.contentHash).toBe(hash);
    expect(putMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("writes a new R2 object when content changes", async () => {
    getMock.mockResolvedValue(undefined);
    const env = { BUCKET: { put: putMock } } as unknown as Env;
    const result = await persistSourceDocument(env, {
      sourceId: "src-1",
      path: "index",
      title: "Hello",
      markdown: "# Hello",
    });

    expect(result.written).toBe(true);
    expect(putMock).toHaveBeenCalledTimes(1);
    expect(putMock.mock.calls[0][0]).toBe(
      contentR2Key("src-1", "doc-fixed-id", result.contentHash),
    );
    expect(insertMock).toHaveBeenCalled();
  });
});
