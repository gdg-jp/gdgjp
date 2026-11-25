import type { AuthUser, UserChapter } from "@gdgjp/gdg-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireUserWithChapter } from "~/features/auth/auth-redirect";
import { action } from "~/features/tags/page.server";
import { createTag } from "~/features/tags/tag.repository";
import type { PageRequestArgs } from "~/http/request";
import { type TestD1, createTestD1 } from "../../../tests/helpers/sqlite-d1";

vi.mock("~/features/auth/auth-redirect", () => ({ requireUserWithChapter: vi.fn() }));

type Member = { user: AuthUser; chapter: UserChapter };

function member(id: string, chapterId: number, role: UserChapter["role"]): Member {
  return {
    user: { id, email: `${id}@example.com`, name: id, image: null, isAdmin: false },
    chapter: { chapterId, chapterSlug: `chapter-${chapterId}`, role },
  };
}

const owner = member("owner", 101, "member");
const otherOrganizer = member("organizer", 202, "organizer");

let store: TestD1;
let ownerTagId: number;
let chapterTagId: number;

async function post(as: Member, fields: Record<string, string>) {
  vi.mocked(requireUserWithChapter).mockResolvedValue({
    user: as.user,
    chapter: as.chapter,
    chapters: [as.chapter],
  });
  const request = new Request("http://localhost/tags", {
    method: "POST",
    body: new URLSearchParams(fields),
  });
  return action({
    request,
    params: {},
    context: {
      cloudflare: { env: { DB: store.db } as Env, ctx: {} as ExecutionContext },
    },
  } satisfies PageRequestArgs);
}

function tagName(id: number) {
  const row = store.raw.prepare("SELECT name FROM tags WHERE id = ?").get(id);
  return row?.name;
}

beforeEach(async () => {
  store = createTestD1();
  const personal = await createTag(store.db, { name: "owner-tag", ownerUserId: "owner" });
  const chapter = await createTag(store.db, { name: "chapter-tag", ownerChapterId: 101 });
  if (!personal.ok || !chapter.ok) throw new Error("could not seed tags");
  ownerTagId = personal.tag.id;
  chapterTagId = chapter.tag.id;
});

describe("POST /tags ownership", () => {
  it("answers 404 when another chapter's organizer deletes a tag, and the tag survives", async () => {
    for (const id of [ownerTagId, chapterTagId]) {
      const result = await post(otherOrganizer, { intent: "delete", id: String(id) });
      expect(result).toMatchObject({ init: { status: 404 }, data: { error: "Tag not found." } });
    }
    expect(tagName(ownerTagId)).toBe("owner-tag");
    expect(tagName(chapterTagId)).toBe("chapter-tag");
  });

  it("answers 404 when another chapter's organizer renames a tag, and the name is unchanged", async () => {
    for (const id of [ownerTagId, chapterTagId]) {
      const result = await post(otherOrganizer, {
        intent: "update",
        id: String(id),
        name: "taken-over",
        color: "red",
      });
      expect(result).toMatchObject({ init: { status: 404 }, data: { error: "Tag not found." } });
    }
    expect(tagName(ownerTagId)).toBe("owner-tag");
    expect(tagName(chapterTagId)).toBe("chapter-tag");
  });

  it("lets the owner rename and delete their tag", async () => {
    await expect(
      post(owner, { intent: "update", id: String(ownerTagId), name: "renamed", color: "red" }),
    ).resolves.toEqual({ ok: true });
    expect(tagName(ownerTagId)).toBe("renamed");
    await expect(post(owner, { intent: "delete", id: String(ownerTagId) })).resolves.toEqual({
      ok: true,
    });
    await expect(post(owner, { intent: "delete", id: String(chapterTagId) })).resolves.toEqual({
      ok: true,
    });
    expect(tagName(ownerTagId)).toBeUndefined();
    expect(tagName(chapterTagId)).toBeUndefined();
  });
});
