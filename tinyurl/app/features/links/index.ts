export type {
  CreateLinkInput,
  Link,
  LinkPermission,
  LinkRole,
  LinkShareInput,
  LinkVisibility,
} from "./link.types";
export type { ViewerContext } from "./link-policy";
export {
  canEditLink,
  canEditLinkForChapters,
  canViewLink,
  canViewLinkForChapters,
  requireCanEdit,
  requireCanView,
} from "./link-policy";
export {
  addComment,
  addPermission,
  archiveLink,
  deleteComment,
  getLinkById,
  listVisibleLinksPage,
  listPermissionsForLink,
  replaceCommentForAuthor,
  replaceLinkPermissions,
  listComments,
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
export {
  createLinkWithExtras,
  parseCreateLinkInput,
  parseUpdateLinkPatch,
  updateLinkWithExtras,
} from "./link.service";
