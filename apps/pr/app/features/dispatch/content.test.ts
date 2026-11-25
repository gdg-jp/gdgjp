import { describe, expect, it } from "vitest";
import { NO_TINYURL, approvalBlockers, deliverablePost, jstLabel } from "./content";

const post = (attachment: unknown, text = "参加登録は {{shortlink}}") => ({
  posts: [{ text, attachment, staffReminder: { text: "いいねお願いします" } }],
});

describe("deliverablePost", () => {
  it("reads the first post", () => {
    expect(
      deliverablePost(post({ kind: "ogp", link: { url: "https://e.x", ogImage: null } })),
    ).toEqual({
      text: "参加登録は {{shortlink}}",
      attachmentKind: "ogp",
      linkUrl: "https://e.x",
      ogImage: null,
      staffReminderText: "いいねお願いします",
    });
    expect(deliverablePost({ posts: [] })).toBeNull();
  });
});

const setup = (patch: Partial<Parameters<typeof approvalBlockers>[1]> = {}) => ({
  fallbackUrl: null,
  mediaUrl: null,
  tinyurlActive: true,
  ...patch,
});

describe("approvalBlockers", () => {
  it("refuses an OGP post with no OGP image", () => {
    const p = deliverablePost(post({ kind: "ogp", link: { url: "https://e.x", ogImage: null } }));
    expect(approvalBlockers(p, setup())[0]).toContain("OGP-ON-SHORTLINK");
  });
  it("needs a destination for {{shortlink}}", () => {
    const p = deliverablePost(post({ kind: "none", link: null }));
    expect(approvalBlockers(p, setup())).toHaveLength(1);
    expect(
      approvalBlockers(p, setup({ fallbackUrl: "https://gdg.connpass.com/event/1/" })),
    ).toEqual([]);
  });
  it("needs tinyurl activated before a post with {{shortlink}} can be approved", () => {
    const p = deliverablePost(post({ kind: "none", link: { url: "https://e.x", ogImage: null } }));
    expect(approvalBlockers(p, setup({ tinyurlActive: false }))).toEqual([NO_TINYURL]);
  });
});

describe("image posts", () => {
  it("need an approved image (or a media URL) before approval", () => {
    const p = deliverablePost(post({ kind: "image", link: null }, "本文"));
    expect(approvalBlockers(p, setup())[0]).toContain("画像");
    expect(approvalBlockers(p, setup({ mediaUrl: "https://img.gdgs.jp/x" }))).toEqual([]);
  });
});

describe("jstLabel", () => {
  it("shows Japan time", () => {
    expect(jstLabel(Date.UTC(2026, 11, 1, 9, 0) / 1000)).toBe("12/01 18:00");
  });
});
