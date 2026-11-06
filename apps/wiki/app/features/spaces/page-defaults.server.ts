import { eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import { upsertPageAccess } from "~/features/pages/access.server";
import type { getDb } from "~/lib/db.server";
import type { SpaceRow } from "./access.server";

type Db = ReturnType<typeof getDb>;

/**
 * Default sharing for a page created inside a space, expressed with the existing page
 * grants (the inner ACL is not extended):
 *
 * - chapter space → a `chapter` grant (editor) for the space's chapter. Chapter grants
 *   follow live Accounts claims, so "only members of this chapter can read and edit" holds
 *   as membership changes.
 * - shared space (not gdg-jp) → one grant per `user` / `chapter_role:<id>:member` member,
 *   copied at creation. Later membership changes do not rewrite existing pages; the share
 *   dialog stays the place to adjust them.
 * - personal space and gdg-jp → no grants (author-only `restricted`, as in v1).
 */
export async function applySpacePageDefaults(
  db: Db,
  space: Pick<SpaceRow, "id" | "kind" | "chapterId" | "name">,
  pageId: string,
  grantedBy: string,
): Promise<void> {
  if (space.kind === "chapter" && space.chapterId) {
    await upsertPageAccess(db, {
      pageId,
      subjectType: "chapter",
      subjectKey: space.chapterId,
      subjectLabel: space.name,
      role: "editor",
      grantedBy,
    });
    return;
  }
  if (space.kind !== "shared" || space.id === "gdg-jp") return;

  const members = await db
    .select({
      type: schema.spaceMembers.principalType,
      id: schema.spaceMembers.principalId,
      role: schema.spaceMembers.role,
      email: schema.user.email,
      name: schema.user.name,
    })
    .from(schema.spaceMembers)
    .leftJoin(schema.user, eq(schema.user.id, schema.spaceMembers.principalId))
    .where(eq(schema.spaceMembers.spaceId, space.id))
    .all();
  for (const member of members) {
    const role = member.role === "viewer" ? "viewer" : "editor";
    if (member.type === "user" && member.email && member.id !== grantedBy) {
      await upsertPageAccess(db, {
        pageId,
        subjectType: "email",
        subjectKey: member.email,
        subjectLabel: member.name ?? member.email,
        userId: member.id,
        role,
        grantedBy,
      });
    } else if (member.type === "chapter_role" && member.id.endsWith(":member")) {
      const chapterId = member.id.slice(0, -":member".length);
      if (chapterId === "*") continue;
      await upsertPageAccess(db, {
        pageId,
        subjectType: "chapter",
        subjectKey: chapterId,
        subjectLabel: chapterId,
        role,
        grantedBy,
      });
    }
  }
}
