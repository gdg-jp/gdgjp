import { describe, expect, it, vi } from "vitest";
import { answerReady, answerReply, describeSpaces, startInquiry, sweepOverdue } from "./inquiry";
import { memoryPendingStore } from "./pending";
import { chooseReader } from "./reader";
import type { Reader, WikiClient } from "./wiki";

const REDACTED = "会場は梅田。[非公開の記述があります]";

function fakeWiki(lastSeen: number | null) {
  const calls: Array<{ op: string; reader?: Reader; args?: unknown }> = [];
  const wiki: WikiClient = {
    search: vi.fn(async (reader, _q, spaces) => {
      calls.push({ op: "search", reader, args: spaces });
      return {
        spaces: ["tokyo"],
        truncatedSpaces: false,
        pages: [
          {
            space: "tokyo",
            slug: "venue",
            title: "会場",
            url: "https://wiki.gdgs.jp/s/tokyo/wiki/venue",
            snippets: ["梅田"],
          },
        ],
        raw: [
          {
            space: "tokyo",
            sourceId: "src1",
            title: "#general 2026-11",
            source: "Discord",
            url: "https://discord.example/1",
            snippet: "会場は梅田で決定",
          },
        ],
      };
    }),
    page: vi.fn(async (reader, space, slug) => {
      calls.push({ op: "page", reader, args: [space, slug] });
      return slug === "index"
        ? null
        : {
            space,
            slug,
            title: "会場",
            url: `https://wiki.gdgs.jp/s/${space}/wiki/${slug}`,
            content: REDACTED,
          };
    }),
    spaces: vi.fn(),
    addSpaceMember: vi.fn(),
    enqueueAnswer: vi.fn(async (reader, input) => {
      calls.push({ op: "enqueue", reader, args: input });
      return { jobId: "job1", deadlineAt: 1000 + 90 };
    }),
    expireJob: vi.fn(async () => undefined),
    runnerLastSeen: vi.fn(async () => lastSeen),
    postNote: vi.fn(),
  };
  return { wiki, calls };
}

const delivery = {
  platform: "discord" as const,
  applicationId: "app",
  interactionToken: "tok",
  ephemeral: false,
};
const input = (reader: Reader) => ({
  question: "会場はどこ？",
  reader,
  venue: { kind: "discord_guild" as const, guildId: "g1" },
  spaces: ["tokyo"],
  delivery,
  publicReply: true,
  platform: "discord" as const,
  chatUserId: "u1",
});

describe("chooseReader", () => {
  it("answers in a guild channel as the guild even for a linked organizer", () => {
    expect(
      chooseReader({ kind: "discord_guild", guildId: "g1" }, "organizer-token", false),
    ).toEqual({
      kind: "principal",
      type: "discord_guild",
      id: "g1",
    });
  });
  it("uses the asker's token for DMs and the private re-answer", () => {
    expect(chooseReader({ kind: "discord_dm" }, "t", false)).toEqual({ kind: "user", token: "t" });
    expect(chooseReader({ kind: "discord_guild", guildId: "g1" }, "t", true)).toEqual({
      kind: "user",
      token: "t",
    });
    expect(chooseReader({ kind: "discord_dm" }, null, false)).toEqual({ kind: "anonymous" });
  });
});

describe("startInquiry", () => {
  it("bundles only the wiki's redacted page output and raw snippets, read as the chosen reader", async () => {
    const { wiki, calls } = fakeWiki(1000);
    const pending = memoryPendingStore();
    const reader = { kind: "principal", type: "discord_guild", id: "g1" } as const;
    await startInquiry(input(reader), {
      wiki,
      pending,
      deliver: vi.fn(),
      schedule: vi.fn(),
      now: () => 1000,
    });
    for (const call of calls) expect(call.reader).toEqual(reader);
    const enqueued = calls.find((c) => c.op === "enqueue")?.args as {
      bundle: Record<string, string>;
    };
    const bundle = enqueued.bundle;
    const hit = Object.entries(bundle).find(([path]) => path.startsWith("hits/"))?.[1] ?? "";
    expect(hit).toContain(REDACTED);
    const raw = Object.entries(bundle).filter(([path]) => path.startsWith("raw/"));
    expect(raw).toHaveLength(1);
    expect(raw[0]?.[1].split("---\n\n")[1]).toBe("会場は梅田で決定\n");
    expect(pending.rows.get("job1")?.status).toBe("pending");
  });

  it("passes only the guild's chosen spaces to the search", async () => {
    const { wiki, calls } = fakeWiki(1000);
    await startInquiry(input({ kind: "anonymous" }), {
      wiki,
      pending: memoryPendingStore(),
      deliver: vi.fn(),
      schedule: vi.fn(),
      now: () => 1000,
    });
    expect(calls.find((c) => c.op === "search")?.args).toEqual(["tokyo"]);
  });

  it("replies with search results at once when the runner is down, without a job", async () => {
    const { wiki } = fakeWiki(900);
    const deliver = vi.fn();
    await startInquiry(input({ kind: "anonymous" }), {
      wiki,
      pending: memoryPendingStore(),
      deliver,
      schedule: vi.fn(),
      now: () => 1000,
    });
    expect(wiki.enqueueAnswer).not.toHaveBeenCalled();
    expect(deliver.mock.calls[0]?.[1]).toMatchObject({ degraded: true });
    expect(deliver.mock.calls[0]?.[1].text).toContain("検索結果のみ");
  });
});

describe("answer delivery", () => {
  it("delivers once, degrades overdue answers and expires their jobs", async () => {
    const { wiki } = fakeWiki(1000);
    const pending = memoryPendingStore();
    const deliver = vi.fn();
    const deps = { wiki, pending, deliver, schedule: vi.fn(), now: () => 1000 };
    await startInquiry(input({ kind: "anonymous" }), deps);
    const result = {
      answer: "梅田です。",
      citations: [{ url: "https://wiki.gdgs.jp/s/tokyo/wiki/venue" }],
      confidence: "high" as const,
      unanswered: false,
    };
    expect((await answerReady("job1", { status: "succeeded", result }, deps)).delivered).toBe(true);
    expect((await answerReady("job1", { status: "succeeded", result }, deps)).delivered).toBe(
      false,
    );
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver.mock.calls[0]?.[1].text).toContain("<https://wiki.gdgs.jp/s/tokyo/wiki/venue>");

    const late = memoryPendingStore();
    const lateDeps = { ...deps, pending: late, deliver: vi.fn(), now: () => 1000 };
    await startInquiry(input({ kind: "anonymous" }), lateDeps);
    expect(await sweepOverdue({ ...lateDeps, now: () => 2000 })).toBe(1);
    expect(wiki.expireJob).toHaveBeenCalledWith("job1");
    expect(lateDeps.deliver.mock.calls[0]?.[1]).toMatchObject({ degraded: true });
    expect((await answerReady("job1", { status: "succeeded", result }, lateDeps)).delivered).toBe(
      false,
    );
  });
});

describe("answerReply", () => {
  const row = {
    delivery,
    question: "DevFest Kansai 2026 の会場は？",
    hits: [],
    spaces: ["gdg-jp", "e2e-eval"],
    excludedSpaces: [],
    publicReply: true,
    platform: "discord" as const,
    chatUserId: "u1",
    venue: "discord_guild" as const,
    readerKind: "principal" as const,
    createdAt: 1000,
    jobId: "job1",
    deadlineAt: 1090,
    status: "pending" as const,
  };
  it("quotes the question and lists only citations the answer does not already link", () => {
    const reply = answerReply(row, {
      answer:
        "会場は IPUT Osaka です。[会場資料](https://wiki.gdgs.jp/s/gdg-jp/wiki/venues/iput-osaka)",
      citations: [
        { url: "https://wiki.gdgs.jp/s/gdg-jp/wiki/venues/iput-osaka" },
        { url: "https://wiki.gdgs.jp/s/gdg-jp/wiki/events/devfest" },
      ],
      confidence: "high",
      unanswered: false,
    });
    expect(reply.text.startsWith("> **Q:** DevFest Kansai 2026 の会場は？\n")).toBe(true);
    expect(reply.text).not.toContain("見つかりませんでした");
    expect(reply.text).toContain("- <https://wiki.gdgs.jp/s/gdg-jp/wiki/events/devfest>");
    expect(reply.text).not.toContain("- <https://wiki.gdgs.jp/s/gdg-jp/wiki/venues/iput-osaka>");
    expect(reply.citations).toHaveLength(2);
  });
  it("says a partial answer is partial, and how to widen a public one", () => {
    const partial = answerReply(row, {
      answer: "会場は IPUT Osaka。費用は不明。",
      citations: [{ url: "https://wiki.gdgs.jp/s/gdg-jp/wiki/venues/iput-osaka" }],
      confidence: "medium",
      unanswered: true,
    });
    expect(partial.text).toContain(
      "一部は Wiki で見つかりませんでした（検索したスペース: gdg-jp, e2e-eval）",
    );
    expect(partial.text).toContain("自分の権限で再回答");
    const none = answerReply(
      { ...row, publicReply: false },
      { answer: "見当たりません。", citations: [], confidence: "low", unanswered: true },
    );
    expect(none.text).toContain("\nWiki で見つかりませんでした");
    expect(none.text).not.toContain("自分の権限で再回答");
  });
  it("counts personal spaces instead of listing their opaque slugs", () => {
    expect(describeSpaces(["gdg-jp", "c-1", "u-e5710c24-a46b"])).toBe("gdg-jp, c-1, ほか 1 件");
    expect(describeSpaces(["a", "b", "c", "d", "e", "f"])).toBe("a, b, c, d, ほか 2 件");
    expect(describeSpaces([])).toBe("なし");
  });
});
