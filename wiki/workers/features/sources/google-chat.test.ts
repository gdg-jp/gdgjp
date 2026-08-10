import { describe, expect, it, vi } from "vitest";
import {
  GOOGLE_DIRECTORY_READONLY_SCOPE,
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
  resolveDirectoryPeopleDisplayNames,
  resolvePeopleDisplayNames,
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

  it("uses a clear resource-id fallback rather than a sender displayName", () => {
    expect(defaultSenderName({ name: "users/123", type: "HUMAN" })).toBe(
      "Unknown user (users/123)",
    );
  });

  it("prefers a Chat payload displayName over the resource-id fallback", () => {
    expect(
      defaultSenderName({ name: "users/123", type: "HUMAN", displayName: "  Taro Yamada  " }),
    ).toBe("Taro Yamada");
  });

  it("renders the payload displayName when the resolver has no entry", () => {
    const [week] = normalizeChatMessages([
      {
        name: "spaces/AAA/messages/1",
        text: "Hello from a consumer space.",
        createTime: "2026-07-14T12:03:00Z",
        sender: { name: "users/111", type: "HUMAN", displayName: "Taro Yamada" },
        thread: { name: "spaces/AAA/threads/t1" },
        threadReply: false,
      },
    ]);

    expect(week?.markdown).toContain("### [2026-07-14 21:03] Taro Yamada");
    expect(week?.markdown).not.toContain("Unknown user");
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

describe("extractUrlsFromMessage", () => {
  it("strips trailing punctuation from body URLs", () => {
    expect(extractUrlsFromMessage({ text: "See https://example.com/path)." })).toEqual([
      "https://example.com/path",
    ]);
  });
});

describe("Google Chat identity and thread context fetches", () => {
  it("uses the domain directory as the primary sender resolver", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          people: [
            {
              resourceName: "people/111",
              metadata: { sources: [{ id: "111" }] },
              names: [{ displayName: "Taro Yamada" }],
            },
          ],
        }),
      ),
    );

    const result = await resolveDirectoryPeopleDisplayNames("token");

    const request = new URL(String(fetchSpy.mock.calls[0]?.[0]));
    expect(request.pathname).toBe("/v1/people:listDirectoryPeople");
    expect(request.searchParams.get("sources")).toBe("DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE");
    expect(result).toEqual({
      names: new Map([["users/111", "Taro Yamada"]]),
      nextPageToken: null,
      complete: true,
    });
    fetchSpy.mockRestore();
  });

  it("stops People batch lookup before exceeding the tick budget", async () => {
    const senders = Array.from({ length: 250 }, (_, index) => ({
      name: `users/${index}`,
      type: "HUMAN" as const,
    }));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));

    const result = await resolvePeopleDisplayNames("token", senders, {
      shouldContinue: () => false,
    });

    expect(result).toEqual({ names: new Map(), attempted: new Set() });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("falls back to the email local part when People has no display name", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          responses: [
            {
              requestedResourceName: "people/111",
              httpStatusCode: 200,
              person: { emailAddresses: [{ value: "taro.yamada@example.com" }] },
            },
          ],
        }),
      ),
    );

    const { names } = await resolvePeopleDisplayNames("token", [
      { name: "users/111", type: "HUMAN" },
    ]);

    expect(names.get("users/111")).toBe("taro.yamada");
    fetchSpy.mockRestore();
  });

  it("resolves each distinct human sender once per fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          responses: [
            {
              requestedResourceName: "people/111",
              httpStatusCode: 200,
              person: { resourceName: "people/111", names: [{ displayName: "Taro Yamada" }] },
            },
          ],
        }),
      ),
    );

    const { names, attempted } = await resolvePeopleDisplayNames("token", [
      { name: "users/111", type: "HUMAN" },
      { name: "users/111", type: "HUMAN" },
      { name: "users/bot", type: "BOT" },
    ]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("people:batchGet");
    expect(names).toEqual(
      new Map([
        ["users/bot", "Bot"],
        ["users/111", "Taro Yamada"],
      ]),
    );
    expect(attempted).toEqual(new Set(["users/111"]));
    fetchSpy.mockRestore();
  });

  it("warns structurally and omits unresolved senders from names", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 404 }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { names, attempted } = await resolvePeopleDisplayNames("token", [
      { name: "users/404", type: "HUMAN" },
    ]);

    expect(names.has("users/404")).toBe(false);
    expect(attempted).toEqual(new Set(["users/404"]));
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

  it("logs directory_unavailable when the Workspace directory is missing", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 403 }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await resolveDirectoryPeopleDisplayNames("token");

    expect(result).toEqual({ names: new Map(), nextPageToken: null, complete: true });
    expect(warnSpy).toHaveBeenCalledWith(
      JSON.stringify({
        component: "sources",
        integration: "google-chat",
        event: "directory_unavailable",
        status: 403,
      }),
    );
    warnSpy.mockRestore();
    errorSpy.mockRestore();
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

  it("accepts tokens that include Drive, Chat, and directory scopes", () => {
    expect(
      hasRequiredGoogleChatScopes(
        [
          "https://www.googleapis.com/auth/chat.spaces.readonly",
          "https://www.googleapis.com/auth/chat.messages.readonly",
          "https://www.googleapis.com/auth/directory.readonly",
          GOOGLE_DRIVE_READONLY_SCOPE,
        ].join(" "),
      ),
    ).toBe(true);
  });

  it("does not retry a missing-scope failure", () => {
    expect(isRetryableFetchError(new Error(GOOGLE_CHAT_REAUTH_MESSAGE))).toBe(false);
  });
});
