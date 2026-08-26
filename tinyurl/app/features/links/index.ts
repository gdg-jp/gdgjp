export type {
  CreateLinkInput,
  Link,
  LinkPermission,
  LinkRole,
  LinkShareInput,
  LinkVisibility,
} from "./link.types";
export type { ViewerContext } from "./link-policy";
export { canEditLink, canViewLink, requireCanEdit, requireCanView } from "./link-policy";
export {
  addComment,
  addPermission,
  archiveLink,
  deleteComment,
  getLinkById,
  listComments,
  listPermissionsForLink,
  removePermission,
  restoreLink,
  softDeleteLink,
  updateLink,
  updatePermissionRole,
} from "./link.repository";
export type {
  LinkServiceActor,
  LinkServiceDependencies,
  UpdateLinkPatch,
} from "./link.service";
export { createLinkWithExtras, updateLinkWithExtras } from "./link.service";
