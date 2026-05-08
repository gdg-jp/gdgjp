import { describe, expect, it } from "vitest";
import type { Chapter, UserSummary } from "./db";
import { __renderers } from "./email.server";

const chapter: Chapter = {
  id: 1,
  slug: "gdg-tokyo",
  name: "GDG Tokyo",
  kind: "gdg",
  createdAt: 0,
};

const requester: UserSummary = {
  id: "u_1",
  email: "alice@example.com",
  name: "Alice",
};

const appUrl = "https://accounts.gdgs.jp";

describe("email renderers", () => {
  it("renders Japanese join-request submitted email", () => {
    const r = __renderers.requestSubmitted("ja", { chapter, requester, appUrl });
    expect(r.subject).toContain("GDG Tokyo");
    expect(r.subject).toContain("参加リクエスト");
    expect(r.html).toContain("Alice");
    expect(r.html).toContain("alice@example.com");
    expect(r.html).toContain(`${appUrl}/chapters/${chapter.slug}/organize`);
    expect(r.text).toContain("Alice");
  });

  it("renders English join-request submitted email", () => {
    const r = __renderers.requestSubmitted("en", { chapter, requester, appUrl });
    expect(r.subject).toContain("GDG Tokyo");
    expect(r.html).toContain("requested to join");
  });

  it("renders approved email with dashboard CTA", () => {
    const ja = __renderers.requestApproved("ja", { chapter, appUrl });
    const en = __renderers.requestApproved("en", { chapter, appUrl });
    expect(ja.html).toContain(`${appUrl}/dashboard`);
    expect(en.subject).toMatch(/approved/i);
  });

  it("renders rejected email with chapters CTA", () => {
    const en = __renderers.requestRejected("en", { chapter, appUrl });
    expect(en.html).toContain(`${appUrl}/chapters`);
    expect(en.subject).toMatch(/Update on your request/i);
  });

  it("renders member-left email naming the former member", () => {
    const ja = __renderers.memberLeft("ja", { chapter, formerMember: requester, appUrl });
    expect(ja.html).toContain("Alice");
    expect(ja.subject).toContain("退会");
  });

  it("escapes HTML special characters in user input", () => {
    const evil: UserSummary = {
      id: "u_2",
      email: "bob@example.com",
      name: "<script>alert('x')</script>",
    };
    const r = __renderers.requestSubmitted("en", { chapter, requester: evil, appUrl });
    expect(r.html).not.toContain("<script>alert");
    expect(r.html).toContain("&lt;script&gt;");
  });
});
