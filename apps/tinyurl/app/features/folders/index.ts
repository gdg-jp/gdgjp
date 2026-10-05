/** Folder boundary used by both browser and CLI adapters. */
export {
  canEditFolder,
  canViewFolder,
  getFolderById,
  listAccessibleFoldersPage,
} from "~/features/folders/folder-access.repository";
export { createFolder, deleteFolder, updateFolder } from "~/features/folders/folder.repository";
export {
  getAccessibleFolder,
  listAccessibleChildFoldersWithCounts,
  listAccessibleRootFoldersWithCounts,
} from "~/features/folders/folder-access.repository";
export type { Folder, FolderViewer, FolderWithCounts } from "~/features/folders/folder-record";
