/**
 * Barrel for the sources server surface. The implementation is split by "reason
 * to read": `classify.ts` (URL / space / channel classification, pure),
 * `permissions.ts` (visibility + chapter assignment checks, pure),
 * `create.server.ts` (register + inline-create), `lifecycle.server.ts`
 * (unarchive / delete / refresh / visibility update).
 */
export { canAccessSource } from "@gdgjp/gdg-lib/acl";
export type { SourceKind, SourceRefreshPolicy, SourceVisibility } from "~/features/sources/shared";
export * from "./classify";
export * from "./permissions";
export * from "./create.server";
export * from "./inline-source.server";
export * from "./lifecycle.server";
