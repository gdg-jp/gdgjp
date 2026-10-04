import { requireSnsAccess } from "~/features/auth/access.server";
import { listPostMedia } from "~/features/posts/post-media.repository.server";
import { listPosts } from "~/features/posts/post.repository.server";
import { listXAccounts } from "~/features/x-accounts/x-account.repository.server";

export async function loadPosts(request: Request, env: Env) {
  const access = await requireSnsAccess(env, request);
  const [posts, accounts] = await Promise.all([
    listPosts(env.DB, access.chapter.chapterId),
    listXAccounts(env.DB, access.chapter.chapterId),
  ]);
  return {
    ...access,
    posts,
    accounts,
    media: await listPostMedia(
      env.DB,
      posts.map((post) => post.id),
    ),
  };
}
