import { describe, expect, it, vi } from "vitest";
import { fileAnswer, workspacePath } from "./filing";

function fakeDb() {
  const seen = new Set<string>();
  return {
    prepare: () => ({
      bind: (id: string) => ({
        run: async () => {
          const fresh = !seen.has(id);
          seen.add(id);
          return { meta: { changes: fresh ? 1 : 0 } };
        },
      }),
    }),
  } as unknown as D1Database;
}

const result = {
  answer: "x".repeat(250),
  citations: [
    { url: "https://wiki.gdgs.jp/s/gdg-jp/wiki/events/venue" },
    { url: "https://wiki.gdgs.jp/s/gdg-jp/wiki/budget" },
  ],
  confidence: "high" as const,
  unanswered: false,
  filing: { slug: "venue-and-budget", title: "会場と予算", summary: "s", content: "c" },
};

describe("fileAnswer", () => {
  it("maps gdg-jp URLs to workspace paths", () => {
    expect(workspacePath("https://wiki.gdgs.jp/s/gdg-jp/wiki/events/venue")).toBe(
      "/wiki/events/venue",
    );
    expect(workspacePath("https://wiki.gdgs.jp/s/tokyo/wiki/venue")).toBeNull();
  });

  it("files once per message id, and never without a linked token", async () => {
    const db = fakeDb();
    const wiki = {
      postNote: vi.fn(async (_token: string, _note: unknown) => ({ ok: true, status: 200 })),
    };
    const deps = { db, wiki: wiki as never };
    expect(await fileAnswer({ messageId: "m1", token: "t", result }, deps)).toBe("filed");
    expect(await fileAnswer({ messageId: "m1", token: "t", result }, deps)).toBe("duplicate");
    expect(await fileAnswer({ messageId: "m2", token: null, result }, deps)).toBe("skipped");
    expect(wiki.postNote).toHaveBeenCalledTimes(1);
    expect(wiki.postNote.mock.calls[0]?.[1]).toMatchObject({
      citedPaths: ["/wiki/events/venue", "/wiki/budget"],
    });
  });
});
