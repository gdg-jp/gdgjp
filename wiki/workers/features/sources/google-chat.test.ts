import { describe, expect, it, vi } from "vitest";
import {
  GOOGLE_DRIVE_READONLY_SCOPE,
  getGoogleDriveAuthUrl,
  hasRequiredGoogleChatScopes,
} from "../../../app/lib/google-drive.server";
import {
  type ChatMessage,
  GOOGLE_CHAT_REAUTH_MESSAGE,
  THREAD_PARENT_UNAVAILABLE,
  defaultSenderName,
  extractUrlsFromMessage,
  fetchMissingReplyThreadParents,
  mergeDocumentUrls,
  normalizeChatMessages,
  splitMarkdownByUtf8Bytes,
  weekBoundsRfc3339,
  weekPathFromCreateTime,
} from "./google-chat";
import { isRetryableFetchError } from "./retry-classification";

const FIXTURE_MESSAGES: ChatMessage[] = [
  {
    name: "spaces/AAA/messages/1",
    text: "It looks like we can reserve venue X in Umeda. Capacity: 120.\nSee https://example.com/venue",
    createTime: "2026-07-14T12:03:00Z",
    sender: { name: "users/111", type: "HUMAN" },
    thread: { name: "spaces/AAA/threads/t1" },
    threadReply: false,
  },
  {
    name: "spaces/AAA/messages/2",
    text: "We had leftovers last time, so use an 0.8 multiplier for catering.",
    createTime: "2026-07-14T12:05:00Z",
    sender: { name: "users/222", type: "HUMAN" },
    thread: { name: "spaces/AAA/threads/t1" },
    threadReply: true,
  },
  {
    name: "spaces/AAA/messages/3",
    text: "August kickoff is next week.",
    createTime: "2026-08-01T01:00:00Z",
    sender: { name: "users/111", type: "HUMAN" },
    thread: { name: "spaces/AAA/threads/t2" },
    threadReply: false,
  },
];

const FIXTURE_REPLY: ChatMessage = {
  name: "spaces/AAA/messages/2",
  text: "We had leftovers last time, so use an 0.8 multiplier for catering.",
  createTime: "2026-07-14T12:05:00Z",
  sender: { name: "users/222", type: "HUMAN" },
  thread: { name: "spaces/AAA/threads/t1" },
  threadReply: true,
};

const resolveFixtureSender = (sender: ChatMessage["sender"]) =>
  sender?.name === "users/111" ? "Taro Yamada" : "Hanako Sato";

describe("normalizeChatMessages", () => {
  it("splits messages into Monday-date weekly documents and groups replies with their root", () => {
    const weeks = normalizeChatMessages(FIXTURE_MESSAGES, {
      resolveSenderName: resolveFixtureSender,
    });

    expect(weeks.map((week) => week.path)).toEqual(["2026-07-13", "2026-07-27"]);
    expect(weeks[0]?.title).toBe("2026-07-13 – 2026-07-19");
    expect(weeks[0]?.markdown).toMatchInlineSnapshot(`
      "## [2026-07-14 21:03] It looks like we can reserve venue X in Umeda. Capacity: ...

      ### [2026-07-14 21:03] Taro Yamada

      It looks like we can reserve venue X in Umeda. Capacity: 120.
      See https://example.com/venue

      ### [2026-07-14 21:05] Hanako Sato

      We had leftovers last time, so use an 0.8 multiplier for catering.
      "
    `);
    expect(weeks[1]?.markdown).toMatchInlineSnapshot(`
      "## [2026-08-01 10:00] August kickoff is next week.

      ### [2026-08-01 10:00] Taro Yamada

      August kickoff is next week.
      "
    `);
  });

  it("does not add a parent quote when the parent is in the same week", () => {
    const week = normalizeChatMessages(FIXTURE_MESSAGES, {
      resolveSenderName: resolveFixtureSender,
    }).find((item) => item.path === "2026-07-13");
    expect(week?.markdown).not.toContain("> It looks like we can reserve venue X");
    expect(week?.markdown).toContain("0.8 multiplier for catering");
  });

  it("keeps only messages after a cursor when the caller filters the fixture", () => {
    const cursor = "2026-07-14T12:03:00Z";
    const filtered = FIXTURE_MESSAGES.filter((message) => (message.createTime ?? "") > cursor);
    const weeks = normalizeChatMessages(filtered, { resolveSenderName: resolveFixtureSender });

    expect(weeks.map((week) => week.path)).toEqual(["2026-07-13", "2026-07-27"]);
    expect(weeks[0]?.markdown).not.toContain("venue X");
    expect(weeks[0]?.markdown).toContain("0.8 multiplier");
    expect(weeks[0]?.cursor).toBe("2026-07-14T12:05:00Z");
  });

  it("records extracted URLs for Stage 3 metadata", () => {
    const july = normalizeChatMessages(FIXTURE_MESSAGES, {
      resolveSenderName: resolveFixtureSender,
    }).find((week) => week.path === "2026-07-13");
    expect(july?.urls).toEqual(["https://example.com/venue"]);
  });

  it("uses Asia/Tokyo and Monday dates for weekly paths, including a year boundary", () => {
    // 2026-07-31 16:00 UTC is already 2026-08-01 01:00 in Tokyo.
    expect(weekPathFromCreateTime("2026-07-31T16:00:00Z")).toBe("2026-07-27");
    // 2026-01-01 is Thursday, so it belongs to Monday 2025-12-29.
    expect(weekPathFromCreateTime("2025-12-31T15:00:00Z")).toBe("2025-12-29");
    expect(weekBoundsRfc3339("2025-12-29")).toEqual({
      start: "2025-12-28T15:00:00Z",
      end: "2026-01-04T15:00:00Z",
    });
  });

  it("uses a clear resource-id fallback for user-authenticated Chat payloads", () => {
    expect(defaultSenderName({ name: "users/123", type: "HUMAN" })).toBe(
      "Unknown user (users/123)",
    );
  });

  it("quotes a fetched parent without treating it as a message to ingest", () => {
    const [week] = normalizeChatMessages([FIXTURE_REPLY], {
      resolveSenderName: resolveFixtureSender,
      threadParents: new Map([["spaces/AAA/threads/t1", "Original parent"]]),
    });

    expect(week?.markdown).toContain("> Original parent");
    expect(week?.markdown).not.toContain("It looks like we can reserve venue X");
    expect(week?.cursor).toBe("2026-07-14T12:05:00Z");
  });

  it("marks a reply parent unavailable when the parent cannot be fetched", () => {
    const [week] = normalizeChatMessages([FIXTURE_REPLY], {
      resolveSenderName: resolveFixtureSender,
    });

    expect(week?.markdown).toContain(`> _(${THREAD_PARENT_UNAVAILABLE})_`);
  });

  it("does not duplicate an in-week blank parent as a quote", () => {
    const [week] = normalizeChatMessages([
      {
        text: "   ",
        createTime: "2026-07-14T12:03:00Z",
        sender: { name: "users/111", type: "HUMAN" },
        thread: { name: "spaces/AAA/threads/t1" },
        threadReply: false,
      },
      FIXTURE_REPLY,
    ]);

    expect(week?.markdown).not.toContain(`> _(${THREAD_PARENT_UNAVAILABLE})_`);
  });
});

describe("mergeDocumentUrls", () => {
  it("unions URLs into sorted JSON metadata", () => {
    expect(
      mergeDocumentUrls(JSON.stringify({ urls: ["https://b.example"] }), ["https://a.example"]),
    ).toBe(JSON.stringify({ urls: ["https://a.example", "https://b.example"] }));
  });
});

describe("splitMarkdownByUtf8Bytes", () => {
  it("keeps every part within the byte limit without splitting Unicode code points", () => {
    const markdown = "あいうえお😀".repeat(100);
    const parts = splitMarkdownByUtf8Bytes(markdown, 31);

    expect(parts.join("")).toBe(markdown);
    expect(parts.every((part) => new TextEncoder().encode(part).byteLength <= 31)).toBe(true);
  });
});

describe("extractUrlsFromMessage", () => {
  it("strips trailing punctuation from body URLs", () => {
    expect(extractUrlsFromMessage({ text: "See https://example.com/path)." })).toEqual([
      "https://example.com/path",
    ]);
  });
});

describe("Google Chat thread context fetches", () => {
  it("fetches each missing thread parent with a thread.name filter", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          messages: [
            {
              name: "spaces/AAA/messages/1",
              text: "Original parent",
              thread: { name: "spaces/AAA/threads/t1" },
              threadReply: false,
            },
          ],
        }),
      ),
    );

    const parents = await fetchMissingReplyThreadParents("spaces/AAA", "token", [
      FIXTURE_REPLY,
      { ...FIXTURE_REPLY, name: "spaces/AAA/messages/4" },
    ]);

    expect(parents).toEqual(new Map([["spaces/AAA/threads/t1", "Original parent"]]));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const requestUrl = new URL(String(fetchSpy.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.get("filter")).toBe("thread.name = spaces/AAA/threads/t1");
    expect(requestUrl.searchParams.has("orderBy")).toBe(false);
    fetchSpy.mockRestore();
  });

  it("does not cache a fetched parent whose body is blank", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          messages: [
            {
              text: "  \n ",
              thread: { name: "spaces/AAA/threads/t1" },
              threadReply: false,
            },
          ],
        }),
      ),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const parents = await fetchMissingReplyThreadParents("spaces/AAA", "token", [FIXTURE_REPLY]);

    expect(parents).toEqual(new Map());
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"event":"thread_parent_unavailable"'),
    );
    warnSpy.mockRestore();
    fetchSpy.mockRestore();
  });
});

describe("Google Chat scopes", () => {
  it("does not request directory access during Google OAuth", () => {
    const authUrl = new URL(
      getGoogleDriveAuthUrl("client-id", "https://wiki.example/api/google-drive/callback", "state"),
    );

    expect(authUrl.searchParams.get("scope")?.split(" ")).not.toContain(
      "https://www.googleapis.com/auth/directory.readonly",
    );
  });

  it("rejects tokens that lack required Chat scopes", () => {
    expect(
      hasRequiredGoogleChatScopes(
        "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file",
      ),
    ).toBe(false);
    expect(hasRequiredGoogleChatScopes(null)).toBe(false);
  });

  it("accepts tokens that include Drive and Chat scopes", () => {
    expect(
      hasRequiredGoogleChatScopes(
        [
          "https://www.googleapis.com/auth/chat.spaces.readonly",
          "https://www.googleapis.com/auth/chat.messages.readonly",
          GOOGLE_DRIVE_READONLY_SCOPE,
        ].join(" "),
      ),
    ).toBe(true);
  });

  it("does not retry a missing-scope failure", () => {
    expect(isRetryableFetchError(new Error(GOOGLE_CHAT_REAUTH_MESSAGE))).toBe(false);
  });
});
