import { describe, expect, it, vi } from "vitest";
import { GoogleApiError } from "~/features/google/client.server";
import {
  createSubscription,
  deleteSubscription,
  getSubscription,
  listSubscriptions,
  patchSubscriptionTtl,
  reactivateSubscription,
} from "~/features/google/workspace-events.server";

describe("workspace-events.server", () => {
  it("createSubscription が LRO 応答の done / response を解釈する", async () => {
    let capturedInit: RequestInit | undefined;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init;
      return Response.json({
        name: "operations/op-1",
        done: true,
        response: {
          "@type": "type.googleapis.com/google.apps.events.subscriptions.v1.Subscription",
          name: "subscriptions/sub-1",
          targetResource: "//cloudidentity.googleapis.com/users/12345",
          eventTypes: ["google.workspace.meet.conference.v2.ended"],
          notificationEndpoint: { pubsubTopic: "projects/gdgs-meet/topics/meet-events" },
          state: "ACTIVE",
          expireTime: "2026-11-26T00:00:00Z",
        },
      });
    }) as unknown as typeof fetch;

    const result = await createSubscription(
      "token-1",
      {
        targetResource: "//cloudidentity.googleapis.com/users/12345",
        eventTypes: ["google.workspace.meet.conference.v2.ended"],
        pubsubTopic: "projects/gdgs-meet/topics/meet-events",
      },
      fetchMock,
    );

    expect(result.done).toBe(true);
    expect(result.operationName).toBe("operations/op-1");
    expect(result.subscription?.name).toBe("subscriptions/sub-1");
    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      targetResource: "//cloudidentity.googleapis.com/users/12345",
      eventTypes: ["google.workspace.meet.conference.v2.ended"],
      notificationEndpoint: { pubsubTopic: "projects/gdgs-meet/topics/meet-events" },
      payloadOptions: { includeResource: false },
    });
  });

  it("patchSubscriptionTtl が updateMask=ttl と { ttl: '0s' } で PATCH する", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedInit = init;
      return Response.json({
        name: "operations/op-patch",
        done: true,
        response: {
          name: "subscriptions/sub-1",
          targetResource: "//cloudidentity.googleapis.com/users/12345",
          eventTypes: ["google.workspace.meet.conference.v2.ended"],
          notificationEndpoint: { pubsubTopic: "projects/gdgs-meet/topics/meet-events" },
          expireTime: "2026-11-26T00:00:00Z",
        },
      });
    }) as unknown as typeof fetch;

    const result = await patchSubscriptionTtl(
      "token-1",
      "subscriptions/sub-1",
      undefined,
      fetchMock,
    );
    expect(result.subscription?.name).toBe("subscriptions/sub-1");

    const parsedUrl = new URL(capturedUrl);
    expect(parsedUrl.pathname).toBe("/v1/subscriptions/sub-1");
    expect(parsedUrl.searchParams.get("updateMask")).toBe("ttl");
    expect(capturedInit?.method).toBe("PATCH");
    expect(JSON.parse(String(capturedInit?.body))).toEqual({ ttl: "0s" });
  });

  it("listSubscriptions が filter 付きで複数ページを連結取得し、空 filter を拒否する", async () => {
    await expect(
      listSubscriptions("token-1", "   ", vi.fn() as unknown as typeof fetch),
    ).rejects.toThrow();

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes("pageToken=")) {
        return Response.json({
          subscriptions: [{ name: "subscriptions/1" }],
          nextPageToken: "next-1",
        });
      }
      return Response.json({
        subscriptions: [{ name: "subscriptions/2" }],
      });
    }) as unknown as typeof fetch;

    const subs = await listSubscriptions(
      "token-1",
      'event_types:"google.workspace.meet.conference.v2.ended"',
      fetchMock,
    );
    expect(subs.map((s) => s.name)).toEqual(["subscriptions/1", "subscriptions/2"]);
  });

  it("getSubscription / deleteSubscription / reactivateSubscription および LRO error を扱う", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method });
      if (url.endsWith(":reactivate")) {
        return Response.json({
          name: "operations/op-reactivate",
          done: true,
          error: { code: 400, status: "FAILED_PRECONDITION", message: "Subscription expired" },
        });
      }
      if (init?.method === "DELETE") {
        return Response.json({ name: "operations/op-del", done: true });
      }
      return Response.json({ name: "subscriptions/sub-1", state: "ACTIVE" });
    }) as unknown as typeof fetch;

    const sub = await getSubscription("token-1", "subscriptions/sub-1", fetchMock);
    expect(sub.state).toBe("ACTIVE");

    const del = await deleteSubscription("token-1", "subscriptions/sub-1", fetchMock);
    expect(del).toEqual({ done: true, operationName: "operations/op-del" });
    expect(calls[1]).toEqual({
      url: "https://workspaceevents.googleapis.com/v1/subscriptions/sub-1",
      method: "DELETE",
    });

    await expect(
      reactivateSubscription("token-1", "subscriptions/sub-1", fetchMock),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(GoogleApiError);
      const apiErr = err as GoogleApiError;
      expect(apiErr.apiStatus).toBe("FAILED_PRECONDITION");
      expect(apiErr.apiMessage).toBe("Subscription expired");
      return true;
    });
  });
});
