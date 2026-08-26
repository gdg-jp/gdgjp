import type { AuthUser } from "@gdgjp/gdg-lib";
import { isSuperAdmin } from "@gdgjp/gdg-lib";
import type { Link, LinkPermission, LinkRole } from "~/lib/db";
import type { LinkShareInput } from "./link.types";

export type ViewerContext = {
  user: AuthUser;
  chapterId: number | null;
};

function matchingRole(ctx: ViewerContext, permissions: LinkPermission[]): LinkRole | null {
  let best: LinkRole | null = null;
  for (const p of permissions) {
    if (
      (p.principalType === "user" && p.principalId === ctx.user.email) ||
      (p.principalType === "chapter" &&
        ctx.chapterId !== null &&
        p.principalId === String(ctx.chapterId))
    ) {
      if (p.role === "editor") return "editor";
      if (p.role === "viewer") best = "viewer";
    }
  }
  return best;
}

export function canViewLink(
  ctx: ViewerContext,
  link: Link,
  permissions: LinkPermission[],
): boolean {
  if (link.ownerUserId === ctx.user.id) return true;
  if (isSuperAdmin(ctx.user)) return true;
  if (link.ownerChapterId !== null && ctx.chapterId === link.ownerChapterId) return true;
  if (matchingRole(ctx, permissions) !== null) return true;
  // Public links are viewable to any signed-in member. Callers reach this with
  // ctx already established by requireUserWithChapter, so the viewer is one.
  if (link.visibility === "public") return true;
  return false;
}

export function canEditLink(
  ctx: ViewerContext,
  link: Link,
  permissions: LinkPermission[],
): boolean {
  if (link.ownerUserId === ctx.user.id) return true;
  if (isSuperAdmin(ctx.user)) return true;
  if (link.ownerChapterId !== null && ctx.chapterId === link.ownerChapterId) return true;
  return matchingRole(ctx, permissions) === "editor";
}

export function requireCanView(
  ctx: ViewerContext,
  link: Link,
  permissions: LinkPermission[],
): void {
  if (!canViewLink(ctx, link, permissions)) {
    throw new Response("Forbidden", { status: 403 });
  }
}

export function requireCanEdit(
  ctx: ViewerContext,
  link: Link,
  permissions: LinkPermission[],
): void {
  if (!canEditLink(ctx, link, permissions)) {
    throw new Response("Forbidden", { status: 403 });
  }
}

export type ValidatedShare = {
  principalType: "user" | "chapter";
  principalId: string;
  role: "editor" | "viewer";
};

export function validateSharePrincipal(
  share: LinkShareInput,
): { ok: true; share: ValidatedShare } | { ok: false; error: string } {
  const { principalType, principalId, role } = share;
  if (principalType !== "user" && principalType !== "chapter") {
    return { ok: false, error: "Invalid sharing principal type." };
  }
  if (role !== "editor" && role !== "viewer") {
    return { ok: false, error: "Invalid sharing role." };
  }
  if (principalType === "user" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(principalId)) {
    return { ok: false, error: "Invalid sharing email address." };
  }
  if (principalType === "chapter" && !/^\d+$/.test(principalId)) {
    return { ok: false, error: "Sharing chapter id must be a number." };
  }
  return { ok: true, share: { principalType, principalId, role } };
}
