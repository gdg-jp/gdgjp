import { describe, expect, it, vi } from "vitest";
import {
  GOOGLE_DIRECTORY_READONLY_SCOPE,
  getGoogleDriveAuthUrl,
  hasRequiredGoogleChatScopes,
} from "../../../app/lib/google-drive.server";
import { isRetryableFetchError } from "./fetch-source";
import {
  type ChatMessage,
  GOOGLE_CHAT_REAUTH_MESSAGE,
  THREAD_PARENT_UNAVAILABLE,
  appendMonthlyMarkdown,
  defaultSenderName,
  extractUrlsFromMessage,
  fetchMissingReplyThreadParents,
  mergeDocumentUrls,
  monthPathFromCreateTime,
  normalizeChatMessages,
  resolvePeopleDisplayNames,
} from "./google-chat";

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
  it("splits messages across month boundaries into YYYY-MM documents", () => {
    const months = normalizeChatMessages(FIXTURE_MESSAGES, {
      resolveSenderName: resolveFixtureSender,
    });

    expect(months.map((month) => month.path)).toEqual(["2026-07", "2026-08"]);
    expect(months[0]?.markdown).toMatchInlineSnapshot(`
      "## [2026-07-14 21:03] Taro Yamada

      It looks like we can reserve venue X in Umeda. Capacity: 120.
      See https://example.com/venue

      ## [2026-07-14 21:05] Hanako Sato

      > It looks like we can reserve venue X in Umeda. Capacity: 120. See https://example.com/venue

      We had leftovers last time, so use an 0.8 multiplier for catering.
      "
    `);
    expect(months[1]?.markdown).toMatchInlineSnapshot(`
      "## [2026-08-01 10:00] Taro Yamada

      August kickoff is next week.
      "
    `);
  });

  it("nests thread replies under a one-line quote of the parent", () => {
    const july = normalizeChatMessages(FIXTURE_MESSAGES, {
      resolveSenderName: resolveFixtureSender,
    }).find((month) => month.path === "2026-07");
    expect(july?.markdown).toContain(
      "> It looks like we can reserve venue X in Umeda. Capacity: 120. See https://example.com/venue",
    );
    expect(july?.markdown).toContain("0.8 multiplier for catering");
  });

  it("keeps only messages after a cursor when the caller filters the fixture", () => {
    const cursor = "2026-07-14T12:03:00Z";
    const filtered = FIXTURE_MESSAGES.filter((message) => (message.createTime ?? "") > cursor);
    const months = normalizeChatMessages(filtered, { resolveSenderName: resolveFixtureSender });

    expect(months.map((month) => month.path)).toEqual(["2026-07", "2026-08"]);
    expect(months[0]?.markdown).not.toContain("venue X");
    expect(months[0]?.markdown).toContain("0.8 multiplier");
    expect(months[0]?.cursor).toBe("2026-07-14T12:05:00Z");
  });

  it("records extracted URLs for Stage 3 metadata", () => {
    const july = normalizeChatMessages(FIXTURE_MESSAGES, {
      resolveSenderName: resolveFixtureSender,
    }).find((month) => month.path === "2026-07");
    expect(july?.urls).toEqual(["https://example.com/venue"]);
  });

  it("uses Asia/Tokyo for month paths", () => {
    // 2026-07-31 16:00 UTC is already 2026-08-01 01:00 in Tokyo.
    expect(monthPathFromCreateTime("2026-07-31T16:00:00Z")).toBe("2026-08");
  });

  it("uses a clear resource-id fallback rather than a sender displayName", () => {
    expect(defaultSenderName({ name: "users/123", type: "HUMAN" })).toBe(
      "Unknown user (users/123)",
    );
  });

  it("quotes a fetched parent without treating it as a message to ingest", () => {
    const [month] = normalizeChatMessages([FIXTURE_REPLY], {
      resolveSenderName: resolveFixtureSender,
      threadParents: new Map([["spaces/AAA/threads/t1", "Original parent"]]),
    });

    expect(month?.markdown).toContain("> Original parent");
    expect(month?.markdown).not.toContain("It looks like we can reserve venue X");
    expect(month?.cursor).toBe("2026-07-14T12:05:00Z");
  });

  it("marks a reply parent unavailable when the parent cannot be fetched", () => {
    const [month] = normalizeChatMessages([FIXTURE_REPLY], {
      resolveSenderName: resolveFixtureSender,
    });

    expect(month?.markdown).toContain(`> _(${THREAD_PARENT_UNAVAILABLE})_`);
  });

  it("marks an in-window blank parent unavailable", () => {
    const [month] = normalizeChatMessages([
      {
        text: "   ",
        createTime: "2026-07-14T12:03:00Z",
        sender: { name: "users/111", type: "HUMAN" },
        thread: { name: "spaces/AAA/threads/t1" },
        threadReply: false,
      },
      FIXTURE_REPLY,
    ]);

    expect(month?.markdown).toContain(`> _(${THREAD_PARENT_UNAVAILABLE})_`);
  });
});

describe("appendMonthlyMarkdown", () => {
  it("appends new messages under existing monthly markdown", () => {
    const existing = "## [2026-07-14 21:03] Taro Yamada\n\nOld note.\n";
    const addition = "## [2026-07-14 21:05] Hanako Sato\n\nNew note.\n";
    expect(appendMonthlyMarkdown(existing, addition)).toMatchInlineSnapshot(`
      "## [2026-07-14 21:03] Taro Yamada

      Old note.

      ## [2026-07-14 21:05] Hanako Sato

      New note.
      "
    `);
  });
});

describe("mergeDocumentUrls", () => {
  it("unions URLs into sorted JSON metadata", () => {
    expect(
      mergeDocumentUrls(JSON.stringify({ urls: ["https://b.example"] }), ["https://a.example"]),
    ).toBe(JSON.stringify({ urls: ["https://a.example", "https://b.example"] }));
  });
});

describe("extractUrlsFromMessage", () => {
  it("strips trailing punctuation from body URLs", () => {
    expect(extractUrlsFromMessage({ text: "See https://example.com/path)." })).toEqual([
      "https://example.com/path",
    ]);
  });
});

describe("Google Chat identity and thread context fetches", () => {
  it("resolves each distinct human sender once per fetch", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ names: [{ displayName: "Taro Yamada" }] })));

    const names = await resolvePeopleDisplayNames("token", [
      { name: "users/111", type: "HUMAN" },
      { name: "users/111", type: "HUMAN" },
      { name: "users/bot", type: "BOT" },
    ]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(names).toEqual(
      new Map([
        ["users/bot", "Bot"],
        ["users/111", "Taro Yamada"],
      ]),
    );
    fetchSpy.mockRestore();
  });

  it("warns structurally and uses the explicit fallback when a name is unavailable", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 404 }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const names = await resolvePeopleDisplayNames("token", [{ name: "users/404", type: "HUMAN" }]);

    expect(names.get("users/404")).toBe("Unknown user (users/404)");
    expect(warnSpy).toHaveBeenCalledWith(
      JSON.stringify({
        component: "sources",
        integration: "google-chat",
        event: "sender_name_unresolved",
        sender: "users/404",
        status: 404,
      }),
    );
    warnSpy.mockRestore();
    fetchSpy.mockRestore();
  });

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
    expect(requestUrl.searchParams.get("orderBy")).toBe("ASC");
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
  it("requests directory access during Google OAuth", () => {
    const authUrl = new URL(
      getGoogleDriveAuthUrl("client-id", "https://wiki.example/api/google-drive/callback", "state"),
    );

    expect(authUrl.searchParams.get("scope")?.split(" ")).toContain(
      GOOGLE_DIRECTORY_READONLY_SCOPE,
    );
  });

  it("rejects tokens that lack required Chat or directory scopes", () => {
    expect(
      hasRequiredGoogleChatScopes(
        "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file",
      ),
    ).toBe(false);
    expect(
      hasRequiredGoogleChatScopes(
        [
          "https://www.googleapis.com/auth/chat.spaces.readonly",
          "https://www.googleapis.com/auth/chat.messages.readonly",
        ].join(" "),
      ),
    ).toBe(false);
    expect(hasRequiredGoogleChatScopes(null)).toBe(false);
  });

  it("accepts tokens that include the Chat and directory scopes", () => {
    expect(
      hasRequiredGoogleChatScopes(
        [
          "https://www.googleapis.com/auth/drive.readonly",
          "https://www.googleapis.com/auth/chat.spaces.readonly",
          "https://www.googleapis.com/auth/chat.messages.readonly",
          "https://www.googleapis.com/auth/directory.readonly",
        ].join(" "),
      ),
    ).toBe(true);
  });

  it("does not retry a missing-scope failure", () => {
    expect(isRetryableFetchError(new Error(GOOGLE_CHAT_REAUTH_MESSAGE))).toBe(false);
  });
});
