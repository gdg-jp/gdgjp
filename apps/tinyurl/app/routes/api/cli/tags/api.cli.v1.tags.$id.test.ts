import type { AuthUser, UserChapter } from "@gdgjp/gdg-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireCliActor } from "~/features/auth/cli-auth.server";
import { createTag } from "~/features/tags/tag.repository";
import { type TestD1, createTestD1 } from "../../../../../tests/helpers/sqlite-d1";
import type { Route } from "./+types/api.cli.v1.tags.$id";
import { action } from "./api.cli.v1.tags.$id";

vi.mock("~/features/auth/cli-auth.server", () => ({ requireCliActor: vi.fn() }));

function actor(id: string, chapterId: number) {
  return {
    user: { id, email: `${id}@example.com`, name: id, image: null, isAdmin: false } as AuthUser,
    chapters: [
      { chapterId, chapterSlug: `chapter-${chapterId}`, role: "organizer" },
    ] as UserChapter[],
  };
}

let store: TestD1;
let tagId: number;

function send(as: ReturnType<typeof actor>, method: string, body?: unknown) {
  vi.mocked(requireCliActor).mockResolvedValue({ ok: true, actor: as });
  const request = new Request(`https://url.example/api/cli/v1/tags/${tagId}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  return action({
    request,
    params: { id: String(tagId) },
    context: { cloudflare: { env: { DB: store.db } as Env, ctx: {} as ExecutionContext } },
  } as unknown as Route.ActionArgs);
}

function tagName() {
  return store.raw.prepare("SELECT name FROM tags WHERE id = ?").get(tagId)?.name;
}

beforeEach(async () => {
  store = createTestD1();
  const result = await createTag(store.db, { name: "chapter-tag", ownerChapterId: 101 });
  if (!result.ok) throw new Error("could not seed tag");
  tagId = result.tag.id;
});

describe("CLI tag writes", () => {
  it("answers 404 to another chapter's organizer and leaves the tag", async () => {
    const outsider = actor("outsider", 202);
    expect((await send(outsider, "PATCH", { name: "taken-over" })).status).toBe(404);
    expect((await send(outsider, "DELETE")).status).toBe(404);
    expect(tagName()).toBe("chapter-tag");
  });

  it("lets a member of the owning chapter rename and delete the tag", async () => {
    const member = actor("member", 101);
    const renamed = await send(member, "PATCH", { name: "renamed" });
    expect(renamed.status).toBe(200);
    await expect(renamed.json()).resolves.toMatchObject({ tag: { id: tagId, name: "renamed" } });
    const deleted = await send(member, "DELETE");
    await expect(deleted.json()).resolves.toEqual({ id: tagId, deleted: true });
    expect(tagName()).toBeUndefined();
  });
});
