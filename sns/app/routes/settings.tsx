import { Form, Link } from "react-router";
import { AppShell } from "~/components/app-shell";
import { requireSnsAccess } from "~/lib/access.server";
import { listContributors, listXAccounts } from "~/lib/db.server";
import type { Route } from "./+types/settings";
export async function loader({ request, context }: Route.LoaderArgs) {
  const access = await requireSnsAccess(context.cloudflare.env, request);
  return {
    ...access,
    accounts: await listXAccounts(context.cloudflare.env.DB, access.chapter.chapterId),
    contributors:
      access.chapter.role === "organizer"
        ? await listContributors(context.cloudflare.env.DB, access.chapter.chapterId)
        : [],
  };
}
export default function Settings({ loaderData }: Route.ComponentProps) {
  const organizer = loaderData.chapter.role === "organizer";
  return (
    <AppShell user={loaderData.user} chapter={loaderData.chapter} chapters={loaderData.chapters}>
      <div className="space-y-6 p-4">
        <h1 className="text-xl font-bold">Settings</h1>
        <section className="rounded-2xl border p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-bold">X accounts</h2>
              <p className="text-sm text-muted-foreground">このチャプターから投稿するアカウント</p>
            </div>
            <Link
              className="rounded-full bg-primary px-3 py-2 text-sm font-bold text-white"
              to="/x/connect?return_to=/settings"
            >
              Xを認可
            </Link>
          </div>
          <div className="mt-3 space-y-2">
            {loaderData.accounts.length ? (
              loaderData.accounts.map((account) => (
                <div
                  key={account.id}
                  className="flex items-center justify-between rounded-xl bg-muted px-3 py-2"
                >
                  <span>@{account.username}</span>
                  <Form method="post" action="/settings/x">
                    <input type="hidden" name="id" value={account.id} />
                    <button
                      type="submit"
                      name="intent"
                      value="revoke"
                      className="text-sm text-red-500"
                    >
                      解除
                    </button>
                  </Form>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">認可済みのXアカウントはありません。</p>
            )}
          </div>
        </section>
        {organizer ? (
          <section className="rounded-2xl border p-4">
            <h2 className="font-bold">Contributors</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              このチャプターの投稿操作を許可するユーザー
            </p>
            <Form method="post" action="/settings/contributors" className="mt-3 flex gap-2">
              <input
                required
                name="email"
                type="email"
                placeholder="user@example.com"
                className="min-w-0 flex-1 rounded-xl border bg-card p-2"
              />
              <button
                type="submit"
                className="rounded-full bg-primary px-3 text-sm font-bold text-white"
              >
                追加
              </button>
            </Form>
            <div className="mt-3 space-y-2">
              {loaderData.contributors.map((contributor) => (
                <Form
                  key={contributor.email}
                  method="post"
                  action="/settings/contributors"
                  className="flex items-center justify-between rounded-xl bg-muted px-3 py-2"
                >
                  <span className="text-sm">{contributor.email}</span>
                  <input type="hidden" name="email" value={contributor.email} />
                  <button
                    type="submit"
                    name="intent"
                    value="remove"
                    className="text-sm text-red-500"
                  >
                    削除
                  </button>
                </Form>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}
