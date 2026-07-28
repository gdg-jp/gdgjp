import { Link, useFetcher } from "react-router";
import { AppShell } from "~/components/app-shell";
import { PostCard } from "~/components/post-card";
import { requireSnsAccess } from "~/lib/access.server";
import { listPostMedia, listPosts, listXAccounts } from "~/lib/db.server";
import type { Route } from "./+types/posts";
export async function loader({ request, context }: Route.LoaderArgs) {
  const access = await requireSnsAccess(context.cloudflare.env, request);
  const [posts, accounts] = await Promise.all([
    listPosts(context.cloudflare.env.DB, access.chapter.chapterId),
    listXAccounts(context.cloudflare.env.DB, access.chapter.chapterId),
  ]);
  return {
    ...access,
    posts,
    accounts,
    media: await listPostMedia(
      context.cloudflare.env.DB,
      posts.map((post) => post.id),
    ),
  };
}
export default function Posts({ loaderData }: Route.ComponentProps) {
  const retryFetcher = useFetcher();
  const accounts = new Map(loaderData.accounts.map((account) => [account.id, account]));
  return (
    <AppShell user={loaderData.user} chapter={loaderData.chapter} chapters={loaderData.chapters}>
      <div className="flex items-center justify-between px-4 py-4">
        <h1 className="text-xl font-bold">Posts</h1>
        <Link
          className="rounded-full bg-primary px-4 py-2 text-sm font-bold text-white"
          to="/schedule"
        >
          予約する
        </Link>
      </div>
      {loaderData.posts.length ? (
        loaderData.posts.map((post) => (
          <div key={post.id}>
            <PostCard
              post={post}
              account={accounts.get(post.xAccountId)}
              media={loaderData.media[post.id] ?? []}
            />
            {!["published", "posting"].includes(post.status) ? (
              <div className="flex justify-end gap-4 border-b px-4 pb-3 text-right">
                {post.status === "failed" ? (
                  <retryFetcher.Form method="post" action="/api/posts">
                    <input type="hidden" name="intent" value="publish" />
                    <input type="hidden" name="postId" value={post.id} />
                    <button
                      type="submit"
                      disabled={retryFetcher.state !== "idle"}
                      className="text-sm text-primary disabled:opacity-50"
                    >
                      再試行
                    </button>
                  </retryFetcher.Form>
                ) : null}
                <Link className="text-sm text-primary" to={`/schedule?edit=${post.id}`}>
                  投稿を編集
                </Link>
              </div>
            ) : null}
          </div>
        ))
      ) : (
        <div className="px-6 py-16 text-center text-muted-foreground">
          予約投稿はまだありません。
          <br />
          <Link className="text-primary" to="/schedule">
            最初の投稿を予約する
          </Link>
        </div>
      )}
    </AppShell>
  );
}
