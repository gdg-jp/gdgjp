import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PublicInvitee } from "../meeting";
import { InviteeListCard } from "./InviteeListCard";

describe("InviteeListCard", () => {
  it("renders empty state when there are no invitees", () => {
    const html = renderToStaticMarkup(<InviteeListCard invitees={[]} />);
    expect(html).toContain("合計 0 名（共同主催者 0 名 / 参加者 0 名）");
    expect(html).toContain("招待者はいません。");
  });

  it("renders circular Avatar inside ItemMedia variant=avatar with accessible labels and fallback icon", () => {
    const invitees: PublicInvitee[] = [
      {
        displayName: "Creator User",
        email: "creator@example.com",
        avatarUrl: "https://lh3.googleusercontent.com/a/creator=s96-c",
        role: "cohost",
        isCreator: true,
        isChapterDerived: true,
      },
      {
        displayName: null,
        email: "guest@example.com",
        avatarUrl: null,
        role: "participant",
        isCreator: false,
        isChapterDerived: false,
      },
    ];

    const html = renderToStaticMarkup(<InviteeListCard invitees={invitees} />);

    expect(html).toContain("合計 2 名（共同主催者 1 名 / 参加者 1 名）");
    expect(html).toContain('data-variant="avatar"');
    expect(html).toContain("gdg-avatar");
    expect(html).toContain('aria-label="Creator User"');
    expect(html).toContain('aria-label="guest@example.com"');
    expect(html).toContain("<svg");
    expect(html).toContain("作成者");
    expect(html).toContain("共同主催者");
    expect(html).toContain("参加者");
    expect(html).toContain("個別メール招待");
  });
});
