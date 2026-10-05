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
  deleteComment,
  replaceCommentForAuthor,
  listComments,
} from "~/features/links/link-comments.repository";
export {
  addPermission,
  listPermissionsForLink,
  replaceLinkPermissions,
  removePermission,
  updatePermissionRole,
} from "~/features/links/link-permissions.repository";
export {
  archiveLink,
  getLinkById,
  listVisibleLinksPage,
  restoreLink,
  softDeleteLink,
  updateLink,
} from "~/features/links/link.repository";
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
