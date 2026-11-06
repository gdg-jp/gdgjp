import { and, eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import type { getDb } from "~/lib/db.server";
import type { SpaceIdentity, SpaceRow } from "./access.server";
import {
  type SpaceKind,
  chapterSpaceSlug,
  isValidSharedSpaceSlug,
  personalSpaceSlug,
} from "./shared";

type Db = ReturnType<typeof getDb>;

export type CreateSpaceResult =
  | { ok: true; space: SpaceRow }
  | { ok: false; error: string; status: number };

async function insertSpace(
  db: Db,
  values: typeof schema.spaces.$inferInsert,
  members: Array<Omit<typeof schema.spaceMembers.$inferInsert, "spaceId">>,
): Promise<CreateSpaceResult> {
  const clash = await db
    .select({ id: schema.spaces.id })
    .from(schema.spaces)
    .where(eq(schema.spaces.slug, values.slug))
    .get();
  if (clash) return { ok: false, error: "slug_taken", status: 409 };
  await db.batch([
    db.insert(schema.spaces).values(values),
    ...members.map((member) =>
      db.insert(schema.spaceMembers).values({ ...member, spaceId: values.id }),
    ),
  ] as unknown as Parameters<Db["batch"]>[0]);
  const space = await db.select().from(schema.spaces).where(eq(schema.spaces.id, values.id)).get();
  if (!space) return { ok: false, error: "create_failed", status: 500 };
  return { ok: true, space };
}

/** One personal space per user (`u-<userId>`); the creator is its only member. */
export async function createPersonalSpace(
  db: Db,
  user: { id: string; name: string },
): Promise<CreateSpaceResult> {
  const slug = personalSpaceSlug(user.id);
  const existing = await db
    .select()
    .from(schema.spaces)
    .where(and(eq(schema.spaces.kind, "personal"), eq(schema.spaces.createdBy, user.id)))
    .get();
  if (existing) return { ok: false, error: "already_exists", status: 409 };
  return insertSpace(
    db,
    { id: slug, slug, name: user.name, kind: "personal", createdBy: user.id },
    [{ principalType: "user", principalId: user.id, role: "owner" }],
  );
}

/**
 * One space per chapter (`c-<chapterId>`), created by an organizer of that chapter (or an
 * admin). Membership is fixed: organizers own it, members edit it, nobody else is added.
 */
export async function createChapterSpace(
  db: Db,
  identity: SpaceIdentity & { user: { id: string; isAdmin?: boolean } },
  chapter: { chapterId: string; name: string },
): Promise<CreateSpaceResult> {
  const isOrganizer = identity.chapters.some(
    (c) => String(c.chapterId) === chapter.chapterId && c.role === "organizer",
  );
  if (!identity.user.isAdmin && !(identity.claimsAvailable && isOrganizer)) {
    return { ok: false, error: "forbidden_chapter", status: 403 };
  }
  const existing = await db
    .select({ id: schema.spaces.id })
    .from(schema.spaces)
    .where(eq(schema.spaces.chapterId, chapter.chapterId))
    .get();
  if (existing) return { ok: false, error: "already_exists", status: 409 };
  const slug = chapterSpaceSlug(chapter.chapterId);
  return insertSpace(
    db,
    {
      id: slug,
      slug,
      name: chapter.name,
      kind: "chapter",
      chapterId: chapter.chapterId,
      createdBy: identity.user.id,
    },
    [
      {
        principalType: "chapter_role",
        principalId: `${chapter.chapterId}:organizer`,
        role: "owner",
      },
      { principalType: "chapter_role", principalId: `${chapter.chapterId}:member`, role: "editor" },
    ],
  );
}

export async function createSharedSpace(
  db: Db,
  user: { id: string },
  input: { slug: string; name: string },
): Promise<CreateSpaceResult> {
  const slug = input.slug.trim().toLowerCase();
  const name = input.name.trim();
  if (!isValidSharedSpaceSlug(slug)) return { ok: false, error: "invalid_slug", status: 400 };
  if (!name || name.length > 80) return { ok: false, error: "invalid_name", status: 400 };
  return insertSpace(
    db,
    { id: crypto.randomUUID(), slug, name, kind: "shared", createdBy: user.id },
    [{ principalType: "user", principalId: user.id, role: "owner" }],
  );
}

export type SpaceSettingsInput = {
  name?: string;
  slug?: string;
  lang?: string;
  translateEnabled?: boolean;
};

/** Owners edit settings. Slug changes are allowed for shared spaces only. */
export async function updateSpaceSettings(
  db: Db,
  space: SpaceRow & { kind: SpaceKind },
  input: SpaceSettingsInput,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const patch: Partial<typeof schema.spaces.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name || name.length > 80) return { ok: false, error: "invalid_name", status: 400 };
    patch.name = name;
  }
  if (input.slug !== undefined && input.slug !== space.slug) {
    if (space.kind !== "shared" || space.id === "gdg-jp") {
      return { ok: false, error: "slug_locked", status: 400 };
    }
    const slug = input.slug.trim().toLowerCase();
    if (!isValidSharedSpaceSlug(slug)) return { ok: false, error: "invalid_slug", status: 400 };
    const clash = await db
      .select({ id: schema.spaces.id })
      .from(schema.spaces)
      .where(eq(schema.spaces.slug, slug))
      .get();
    if (clash) return { ok: false, error: "slug_taken", status: 409 };
    patch.slug = slug;
  }
  if (input.lang !== undefined) {
    if (input.lang !== "ja" && input.lang !== "en") {
      return { ok: false, error: "invalid_lang", status: 400 };
    }
    patch.lang = input.lang;
  }
  if (input.translateEnabled !== undefined) patch.translateEnabled = input.translateEnabled;
  await db.update(schema.spaces).set(patch).where(eq(schema.spaces.id, space.id));
  return { ok: true };
}
