import { and, eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import type { getDb } from "~/lib/db.server";
import type { SpaceRow } from "./access.server";
import { ALLOWED_PRINCIPALS, type PrincipalType, type SpaceKind, isSpaceRole } from "./shared";

type Db = ReturnType<typeof getDb>;

export type MemberRow = typeof schema.spaceMembers.$inferSelect & { label: string };

export type MemberInput = { principalType: string; principalId: string; role: string };

const CHAPTER_ROLE_ID = /^[^:\s]+:(member|organizer)$/;

export function validateMemberInput(
  kind: SpaceKind,
  input: MemberInput,
):
  | { ok: true; value: { principalType: PrincipalType; principalId: string; role: string } }
  | { ok: false; error: string } {
  const allowed = ALLOWED_PRINCIPALS[kind] as readonly string[];
  if (!allowed.includes(input.principalType)) return { ok: false, error: "principal_not_allowed" };
  if (!isSpaceRole(input.role)) return { ok: false, error: "invalid_role" };
  const principalId = input.principalId.trim();
  if (!principalId || principalId === "*") return { ok: false, error: "invalid_principal" };
  if (input.principalType === "chapter_role" && !CHAPTER_ROLE_ID.test(principalId)) {
    return { ok: false, error: "invalid_principal" };
  }
  if (input.principalType === "chat_space" && !principalId.startsWith("spaces/")) {
    return { ok: false, error: "invalid_principal" };
  }
  if (input.principalType === "discord_guild" && !/^\d{5,25}$/.test(principalId)) {
    return { ok: false, error: "invalid_principal" };
  }
  return {
    ok: true,
    value: { principalType: input.principalType as PrincipalType, principalId, role: input.role },
  };
}

/** Add or update a member. Rejects principals the space kind does not accept (§2-b). */
export async function upsertSpaceMember(
  db: Db,
  space: SpaceRow,
  input: MemberInput,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const validated = validateMemberInput(space.kind as SpaceKind, input);
  if (!validated.ok) return { ...validated, status: 400 };
  await db
    .insert(schema.spaceMembers)
    .values({ spaceId: space.id, ...validated.value })
    .onConflictDoUpdate({
      target: [
        schema.spaceMembers.spaceId,
        schema.spaceMembers.principalType,
        schema.spaceMembers.principalId,
      ],
      set: { role: validated.value.role },
    });
  return { ok: true };
}

export async function removeSpaceMember(
  db: Db,
  space: SpaceRow,
  principal: { principalType: string; principalId: string },
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  if ((space.kind as SpaceKind) !== "shared") {
    return { ok: false, error: "principal_not_allowed", status: 400 };
  }
  // Wildcards on gdg-jp reproduce the v1 population; they are not removable from the UI.
  if (principal.principalId === "*") return { ok: false, error: "invalid_principal", status: 400 };
  const owners = await db
    .select({ id: schema.spaceMembers.principalId, type: schema.spaceMembers.principalType })
    .from(schema.spaceMembers)
    .where(and(eq(schema.spaceMembers.spaceId, space.id), eq(schema.spaceMembers.role, "owner")))
    .all();
  const removingLastOwner =
    owners.length === 1 &&
    owners[0]?.id === principal.principalId &&
    owners[0]?.type === principal.principalType;
  if (removingLastOwner) return { ok: false, error: "last_owner", status: 400 };
  await db
    .delete(schema.spaceMembers)
    .where(
      and(
        eq(schema.spaceMembers.spaceId, space.id),
        eq(schema.spaceMembers.principalType, principal.principalType),
        eq(schema.spaceMembers.principalId, principal.principalId),
      ),
    );
  return { ok: true };
}

export async function listSpaceMembers(db: Db, spaceId: string): Promise<MemberRow[]> {
  const rows = await db
    .select({
      member: schema.spaceMembers,
      userName: schema.user.name,
      userEmail: schema.user.email,
    })
    .from(schema.spaceMembers)
    .leftJoin(
      schema.user,
      and(
        eq(schema.spaceMembers.principalType, "user"),
        eq(schema.spaceMembers.principalId, schema.user.id),
      ),
    )
    .where(eq(schema.spaceMembers.spaceId, spaceId))
    .all();
  return rows.map(({ member, userName, userEmail }) => ({
    ...member,
    label: userName ? `${userName} <${userEmail}>` : member.principalId,
  }));
}
