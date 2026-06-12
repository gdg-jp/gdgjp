import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Link } from "./db";
import { getLinkBySlug } from "./db";
import { handleApexRedirect } from "./redirect-handler";

vi.mock("./analytics-engine-write", () => ({
  writeClickEvent: vi.fn(),
}));

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getLinkBySlug: vi.fn(),
  };
});

const link: Link = {
  id: "link_01ARZ3NDEKTSV4RRFFQ69G5FAV",
  slug: "conf",
  destinationUrl: "https://events.example.com/conf",
  title: "Conference <Preview>",
  description: "Fresh preview & details",
  ogImageUrl: "https://cdn.example.com/new-og.png",
  ownerUserId: "user_123",
  ownerChapterId: null,
  visibility: "private",
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
};

const ctx = { waitUntil: vi.fn() } as unknown as ExecutionContext;
const env = {} as Env;
const getLinkBySlugMock = vi.mocked(getLinkBySlug);

describe("handleApexRedirect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getLinkBySlugMock.mockResolvedValue(link);
  });

  it("redirects browser requests to the destination URL", async () => {
    const response = await handleApexRedirect(
      env,
      ctx,
      new Request("https://go.example/conf", {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        },
      }),
      "conf",
    );

    expect(response?.status).toBe(302);
    expect(response?.headers.get("location")).toBe("https://events.example.com/conf");
  });

  it("renders saved OGP metadata for crawler requests", async () => {
    const response = await handleApexRedirect(
      env,
      ctx,
      new Request("https://go.example/conf", {
        headers: { "user-agent": "Twitterbot/1.0" },
      }),
      "conf",
    );
    const html = await response?.text();

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toContain("text/html");
    expect(html).toContain('property="og:url" content="https://go.example/conf"');
    expect(html).toContain('property="og:title" content="Conference &lt;Preview&gt;"');
    expect(html).toContain('property="og:description" content="Fresh preview &amp; details"');
    expect(html).toContain('property="og:image" content="https://cdn.example.com/new-og.png"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
  });
});
