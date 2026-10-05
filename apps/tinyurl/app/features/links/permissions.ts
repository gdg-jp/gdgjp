import type { AuthUser } from "@gdgjp/gdg-lib";
import { isSuperAdmin } from "@gdgjp/gdg-lib";

export function requireSuperAdmin(user: AuthUser): void {
  if (!isSuperAdmin(user)) {
    throw new Response("Forbidden", { status: 403 });
  }
}
