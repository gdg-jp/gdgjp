import { isSuperAdmin } from "@gdgjp/gdg-lib";
import { requireSnsAccess } from "~/features/auth/access.server";
import { canAdministerContributors } from "~/features/contributors/contributor-policy";
import { listContributors } from "~/features/contributors/contributor.repository.server";
import {
  getGooglePhotosAlbum,
  listGooglePhotosPollRuns,
} from "~/features/google-photos/google-photos.repository.server";
import { listXAccounts } from "~/features/x-accounts/x-account.repository.server";

export async function loadSettings(request: Request, env: Env) {
  const access = await requireSnsAccess(env, request);
  const canAdminContributors = canAdministerContributors({
    role: access.chapter.role,
    isSuperAdmin: isSuperAdmin(access.user),
  });
  return {
    ...access,
    canAdminContributors,
    accounts: await listXAccounts(env.DB, access.chapter.chapterId),
    googlePhotosAlbum: await getGooglePhotosAlbum(env.DB, access.chapter.chapterId),
    googlePhotosPollRuns: await listGooglePhotosPollRuns(env.DB, access.chapter.chapterId),
    contributors: canAdminContributors
      ? await listContributors(env.DB, access.chapter.chapterId)
      : [],
  };
}
