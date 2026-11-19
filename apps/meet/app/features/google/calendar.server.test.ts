import { describe, expect, it, vi } from "vitest";
import { deleteEvent, getEvent, insertEvent, patchEvent } from "~/features/google/calendar.server";
import { GoogleApiError } from "~/features/google/client.server";

describe("calendar.server", () => {
  it("insertEvent が conferenceData・conferenceDataVersion=1・sendUpdates・guestsCan* を正しく送信する", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedInit = init;
      return Response.json({
        id: "evt-1",
        htmlLink: "https://calendar.google.com/calendar/event?eid=1",
      });
    }) as unknown as typeof fetch;

    const event = await insertEvent(
      "token-1",
      {
        calendarId: "primary",
        conferenceDataVersion: 1,
        sendUpdates: "all",
        body: {
          summary: "定例ミーティング",
          description: "管理ページ: https://meet.gdgs.jp/meetings/m1",
          start: { dateTime: "2026-12-01T19:00:00+09:00", timeZone: "Asia/Tokyo" },
          end: { dateTime: "2026-12-01T20:00:00+09:00", timeZone: "Asia/Tokyo" },
          attendees: [{ email: "organizer@example.com", displayName: "Organizer" }],
          guestsCanSeeOtherGuests: false,
          guestsCanInviteOthers: false,
          guestsCanModify: false,
          conferenceData: {
            conferenceSolution: { key: { type: "hangoutsMeet" } },
            entryPoints: [
              {
                entryPointType: "video",
                uri: "https://meet.google.com/xxx-yyyy-zzz",
                label: "meet.google.com/xxx-yyyy-zzz",
              },
            ],
          },
          extendedProperties: { private: { gdgsMeetId: "m1" } },
        },
      },
      fetchMock,
    );

    expect(event.id).toBe("evt-1");
    const parsedUrl = new URL(capturedUrl);
    expect(parsedUrl.origin + parsedUrl.pathname).toBe(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    );
    expect(parsedUrl.searchParams.get("conferenceDataVersion")).toBe("1");
    expect(parsedUrl.searchParams.get("sendUpdates")).toBe("all");
    expect(capturedInit?.method).toBe("POST");

    const sentBody = JSON.parse(String(capturedInit?.body));
    expect(sentBody.guestsCanSeeOtherGuests).toBe(false);
    expect(sentBody.guestsCanInviteOthers).toBe(false);
    expect(sentBody.guestsCanModify).toBe(false);
    expect(sentBody.conferenceData.entryPoints[0].uri).toBe("https://meet.google.com/xxx-yyyy-zzz");
  });

  it("patchEvent が supportsAttachments=true・sendUpdates=none・attachments 形式で送信する", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedInit = init;
      return Response.json({ id: "evt-1" });
    }) as unknown as typeof fetch;

    await patchEvent(
      "token-1",
      {
        calendarId: "primary",
        eventId: "evt-1",
        sendUpdates: "none",
        supportsAttachments: true,
        body: {
          attachments: [
            {
              fileUrl: "https://drive.google.com/file/d/file-123/view",
              title: "録画ファイル",
              mimeType: "video/mp4",
            },
          ],
        },
      },
      fetchMock,
    );

    const parsedUrl = new URL(capturedUrl);
    expect(parsedUrl.pathname).toBe("/calendar/v3/calendars/primary/events/evt-1");
    expect(parsedUrl.searchParams.get("supportsAttachments")).toBe("true");
    expect(parsedUrl.searchParams.get("sendUpdates")).toBe("none");
    expect(capturedInit?.method).toBe("PATCH");
    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      attachments: [
        {
          fileUrl: "https://drive.google.com/file/d/file-123/view",
          title: "録画ファイル",
          mimeType: "video/mp4",
        },
      ],
    });
  });

  it("getEvent / deleteEvent が正しく動作し、404 エラーを GoogleApiError で投げる", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: init?.method });
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (String(input).includes("missing")) {
        return Response.json(
          { error: { code: 404, status: "NOT_FOUND", message: "Not Found" } },
          { status: 404 },
        );
      }
      return Response.json({ id: "evt-1", attachments: [] });
    }) as unknown as typeof fetch;

    const loaded = await getEvent("token-1", { eventId: "evt-1" }, fetchMock);
    expect(loaded.id).toBe("evt-1");

    await deleteEvent("token-1", { eventId: "evt-1", sendUpdates: "all" }, fetchMock);
    expect(calls[1]).toEqual({
      url: "https://www.googleapis.com/calendar/v3/calendars/primary/events/evt-1?sendUpdates=all",
      method: "DELETE",
    });

    await expect(getEvent("token-1", { eventId: "missing" }, fetchMock)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(GoogleApiError);
        const apiErr = err as GoogleApiError;
        expect(apiErr.httpStatus).toBe(404);
        expect(apiErr.apiStatus).toBe("NOT_FOUND");
        expect(apiErr.retryable).toBe(false);
        return true;
      },
    );
  });
});
