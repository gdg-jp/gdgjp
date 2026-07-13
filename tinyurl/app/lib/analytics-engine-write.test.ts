import { describe, expect, it, vi } from "vitest";
import { sourceFromRequest, writeClickEvent } from "./analytics-engine-write";
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
  campaignMediaId: null,
  creativeName: null,
  visibility: "private",
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
};

describe("writeClickEvent", () => {
  it.each([
    ["https://go.example/example?s=Tokyo", "tokyo"],
    ["https://go.example/example?s=%20discord-a%20", "discord-a"],
    ["https://go.example/example?s=group_1", "group_1"],
    ["https://go.example/example", ""],
    ["https://go.example/example?s=invalid%20source", ""],
    ["https://go.example/example?s=one&s=two", ""],
    ["https://go.example/example?s=", ""],
  ])("normalizes a single valid source in %s", (url, expected) => {
    expect(sourceFromRequest(new Request(url))).toBe(expected);
  });

  it("appends source as blob10 without moving existing dimensions", () => {
    const writeDataPoint = vi.fn();
    const env = { CLICKS_AE: { writeDataPoint } } as unknown as Env;
    const request = new Request("https://go.example/example?s=Tokyo", {
      headers: { referer: "https://ref.example/path" },
    });

    writeClickEvent(env, request, link);

    const blobs = writeDataPoint.mock.calls[0][0].blobs;
    expect(blobs).toHaveLength(10);
    expect(blobs[0]).toBe("example");
    expect(blobs[5]).toBe("https://ref.example");
    expect(blobs[9]).toBe("tokyo");
  });

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
