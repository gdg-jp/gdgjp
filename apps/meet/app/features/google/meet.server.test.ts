import { describe, expect, it, vi } from "vitest";
import { GoogleApiError } from "~/features/google/client.server";
import {
  createSpace,
  createSpaceMember,
  deleteSpaceMember,
  endActiveConference,
  getConferenceRecord,
  getRecording,
  getSmartNote,
  getSpace,
  getTranscript,
  listConferenceRecords,
  listRecordings,
  listSmartNotes,
  listSpaceMembers,
  listTranscripts,
  patchSpace,
} from "~/features/google/meet.server";

describe("meet.server", () => {
  it("createSpace / getSpace / patchSpace / endActiveConference が期待する URL とボディで呼ばれる", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      if (String(input).endsWith(":endActiveConference")) {
        return new Response("", { status: 200 });
      }
      return Response.json({
        name: "spaces/abc",
        meetingUri: "https://meet.google.com/aaa-bbbb-ccc",
        meetingCode: "aaa-bbbb-ccc",
        config: { accessType: "RESTRICTED", moderation: "ON" },
      });
    }) as unknown as typeof fetch;

    const created = await createSpace("token-1", { accessType: "RESTRICTED" }, fetchMock);
    expect(created.name).toBe("spaces/abc");
    expect(calls[0].url).toBe("https://meet.googleapis.com/v2/spaces");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      config: { accessType: "RESTRICTED", moderation: "ON" },
    });

    await getSpace("token-1", "spaces/abc", fetchMock);
    expect(calls[1].url).toBe("https://meet.googleapis.com/v2/spaces/abc");

    await patchSpace(
      "token-1",
      "spaces/abc",
      { accessType: "TRUSTED" },
      "config.accessType",
      fetchMock,
    );
    expect(calls[2].url).toBe(
      "https://meet.googleapis.com/v2/spaces/abc?updateMask=config.accessType",
    );
    expect(calls[2].init?.method).toBe("PATCH");
    expect(JSON.parse(String(calls[2].init?.body))).toEqual({
      config: { accessType: "TRUSTED" },
    });

    await endActiveConference("token-1", "spaces/abc", fetchMock);
    expect(calls[3].url).toBe("https://meet.googleapis.com/v2/spaces/abc:endActiveConference");
    expect(calls[3].init?.method).toBe("POST");
  });

  it("listSpaceMembers は nextPageToken を追従して全ページを連結取得する", async () => {
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      if (!url.includes("pageToken=")) {
        return Response.json({
          members: [{ name: "spaces/abc/members/1", email: "a@example.com", role: "COHOST" }],
          nextPageToken: "page-2",
        });
      }
      return Response.json({
        members: [{ name: "spaces/abc/members/2", email: "b@example.com" }],
      });
    }) as unknown as typeof fetch;

    const members = await listSpaceMembers("token-1", "spaces/abc", fetchMock);
    expect(members).toHaveLength(2);
    expect(members.map((m) => m.email)).toEqual(["a@example.com", "b@example.com"]);
    expect(requestedUrls).toEqual([
      "https://meet.googleapis.com/v2/spaces/abc/members",
      "https://meet.googleapis.com/v2/spaces/abc/members?pageToken=page-2",
    ]);
  });

  it("createSpaceMember は cohost のみ role を付け、通常参加者は role を省略し、deleteSpaceMember が DELETE を送る", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      return Response.json({ name: "spaces/abc/members/1" });
    }) as unknown as typeof fetch;

    await createSpaceMember(
      "token-1",
      "spaces/abc",
      { email: "cohost@example.com", role: "COHOST" },
      fetchMock,
    );
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      email: "cohost@example.com",
      role: "COHOST",
    });

    await createSpaceMember("token-1", "spaces/abc", { email: "guest@example.com" }, fetchMock);
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({
      email: "guest@example.com",
    });

    await deleteSpaceMember("token-1", "spaces/abc/members/1", fetchMock);
    expect(calls[2].url).toBe("https://meet.googleapis.com/v2/spaces/abc/members/1");
    expect(calls[2].init?.method).toBe("DELETE");
  });

  it("conferenceRecords / recordings / transcripts / smartNotes の一覧・単体取得ができる", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/recordings/"))
        return Response.json({ name: "conferenceRecords/r1/recordings/rec1" });
      if (url.includes("/recordings"))
        return Response.json({ recordings: [{ name: "conferenceRecords/r1/recordings/rec1" }] });
      if (url.includes("/transcripts/"))
        return Response.json({ name: "conferenceRecords/r1/transcripts/t1" });
      if (url.includes("/transcripts"))
        return Response.json({ transcripts: [{ name: "conferenceRecords/r1/transcripts/t1" }] });
      if (url.includes("/smartNotes/"))
        return Response.json({ name: "conferenceRecords/r1/smartNotes/s1" });
      if (url.includes("/smartNotes"))
        return Response.json({ smartNotes: [{ name: "conferenceRecords/r1/smartNotes/s1" }] });
      if (url.includes("/conferenceRecords/"))
        return Response.json({ name: "conferenceRecords/r1", space: "spaces/abc" });
      return Response.json({
        conferenceRecords: [{ name: "conferenceRecords/r1", space: "spaces/abc" }],
      });
    }) as unknown as typeof fetch;

    expect(await listConferenceRecords("t", 'space.name="spaces/abc"', fetchMock)).toHaveLength(1);
    expect((await getConferenceRecord("t", "conferenceRecords/r1", fetchMock)).space).toBe(
      "spaces/abc",
    );
    expect(await listRecordings("t", "conferenceRecords/r1", fetchMock)).toHaveLength(1);
    expect(
      (await getRecording("t", "conferenceRecords/r1/recordings/rec1", fetchMock)).name,
    ).toContain("rec1");
    expect(await listTranscripts("t", "conferenceRecords/r1", fetchMock)).toHaveLength(1);
    expect(
      (await getTranscript("t", "conferenceRecords/r1/transcripts/t1", fetchMock)).name,
    ).toContain("t1");
    expect(await listSmartNotes("t", "conferenceRecords/r1", fetchMock)).toHaveLength(1);
    expect(
      (await getSmartNote("t", "conferenceRecords/r1/smartNotes/s1", fetchMock)).name,
    ).toContain("s1");
  });

  it("Google エラー応答の httpStatus / apiStatus / apiMessage / retryable を型付きで保持する", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        {
          error: {
            code: 429,
            status: "RESOURCE_EXHAUSTED",
            message: "Quota exceeded for quota metric",
          },
        },
        { status: 429 },
      ),
    ) as unknown as typeof fetch;

    await expect(getSpace("token-1", "spaces/abc", fetchMock)).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(GoogleApiError);
      const apiErr = err as GoogleApiError;
      expect(apiErr.httpStatus).toBe(429);
      expect(apiErr.apiStatus).toBe("RESOURCE_EXHAUSTED");
      expect(apiErr.apiMessage).toBe("Quota exceeded for quota metric");
      expect(apiErr.retryable).toBe(true);
      return true;
    });
  });
});
