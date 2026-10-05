import { Link, useFetcher } from "react-router";
import { PostCard } from "~/features/posts/components/post-card";
import { loadPosts } from "~/features/posts/post-list.server";
import { AppShell } from "~/layouts/app-shell";
import type { Route } from "./+types/list";

export function loader({ request, context }: Route.LoaderArgs) {
  return loadPosts(request, context.cloudflare.env);
}

export default function PostsPage({ loaderData }: Route.ComponentProps) {
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
              editHref={
                !["published", "posting"].includes(post.status)
                  ? `/schedule?edit=${post.id}`
                  : undefined
              }
            />
            {post.status === "failed" ? (
              <div className="flex justify-end px-4 pb-3 text-right">
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
