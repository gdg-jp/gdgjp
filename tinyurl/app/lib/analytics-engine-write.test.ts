import { describe, expect, it, vi } from "vitest";
import { writeClickEvent } from "./analytics-engine-write";
import type { Link } from "./db";

const link: Link = {
  id: "link_01ARZ3NDEKTSV4RRFFQ69G5FAV",
  slug: "example",
  destinationUrl: "https://example.com",
  title: null,
  description: null,
  ogImageUrl: null,
  ownerUserId: "user_123",
  ownerChapterId: null,
  visibility: "private",
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
};

describe("writeClickEvent", () => {
  it("stores only the referer origin", () => {
    const writeDataPoint = vi.fn();
    const env = { CLICKS_AE: { writeDataPoint } } as unknown as Env;
    const request = new Request("https://go.example/example", {
      headers: {
        referer: "https://ref.example:8443/private/path?email=user@example.com",
      },
    });

    writeClickEvent(env, request, link);

    expect(writeDataPoint).toHaveBeenCalledWith(
      expect.objectContaining({
        blobs: expect.arrayContaining(["https://ref.example:8443"]),
      }),
    );
    expect(writeDataPoint.mock.calls[0][0].blobs).not.toContain(
      "https://ref.example:8443/private/path?email=user@example.com",
    );
  });

  it("stores an empty referer for invalid values", () => {
    const writeDataPoint = vi.fn();
    const env = { CLICKS_AE: { writeDataPoint } } as unknown as Env;
    const request = new Request("https://go.example/example", {
      headers: { referer: "not a valid url" },
    });

    writeClickEvent(env, request, link);

    expect(writeDataPoint.mock.calls[0][0].blobs[5]).toBe("");
  });
});
