import type { LoaderFunctionArgs } from "react-router";
import { requireUser } from "~/features/auth/utils.server";
import { isDriveFolderId, listDriveFolderSourceFiles } from "~/features/google/drive-folder.server";
import { getGoogleDriveAccessToken } from "~/features/google/drive-token.server";
import { getDb } from "~/lib/db.server";

const MAX_FOLDERS_PER_REQUEST = 20;

/**
 * Expand Drive folders picked in the add-source panel into the Docs / Sheets / Slides files
 * beneath them (`?folderId=…`, repeatable). Lists with the signed-in user's own Drive token, so it
 * only ever returns files that user can already open.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const folderIds = new URL(request.url).searchParams.getAll("folderId");
  if (
    folderIds.length === 0 ||
    folderIds.length > MAX_FOLDERS_PER_REQUEST ||
    !folderIds.every(isDriveFolderId)
  ) {
    return Response.json({ error: "invalid_folder" }, { status: 400 });
  }

  let accessToken: string;
  try {
    accessToken = await getGoogleDriveAccessToken(env, getDb(env), user.id);
  } catch {
    return Response.json({ error: "drive_not_connected" }, { status: 401 });
  }

  try {
    return Response.json(await listDriveFolderSourceFiles(folderIds, accessToken));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[google-drive] folder listing failed", message);
    return Response.json({ error: "folder_list_failed" }, { status: 502 });
  }
}
