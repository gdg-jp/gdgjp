import { useEffect, useState } from "react";
import { Form, Link, useFetcher } from "react-router";
import { loadSettings } from "~/features/settings/settings.server";
import { RevokeXAccountDialog } from "~/features/x-accounts/components/revoke-x-account-dialog";
import { AppShell } from "~/layouts/app-shell";
import type { Route } from "./+types/settings";

type ContributorCandidate = { email: string; name: string; image: string | null };

function useDebouncedValue(value: string, delay = 250) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);

  return debouncedValue;
}

export function loader({ request, context }: Route.LoaderArgs) {
  return loadSettings(request, context.cloudflare.env);
}

export default function SettingsPage({ loaderData }: Route.ComponentProps) {
  const organizer = loaderData.chapter.role === "organizer";
  const canAdminContributors = loaderData.canAdminContributors;
  const [contributorQuery, setContributorQuery] = useState("");
  const [showContributorCandidates, setShowContributorCandidates] = useState(false);
  const debouncedContributorQuery = useDebouncedValue(contributorQuery);
  const contributorCandidates = useFetcher<{ candidates: ContributorCandidate[] }>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: fetcher functions are stable
  useEffect(() => {
    if (!canAdminContributors || !showContributorCandidates) return;
    contributorCandidates.load(
      `/api/contributor-candidates?q=${encodeURIComponent(debouncedContributorQuery)}`,
    );
  }, [debouncedContributorQuery, canAdminContributors, showContributorCandidates]);

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
                  <RevokeXAccountDialog accountId={account.id} xUserId={account.xUserId} />
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">認可済みのXアカウントはありません。</p>
            )}
          </div>
        </section>
        {canAdminContributors ? (
          <section className="rounded-2xl border p-4">
            <h2 className="font-bold">Contributors</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              このチャプターの投稿操作を許可するユーザー
            </p>
            <Form method="post" action="/settings/contributors" className="mt-3 flex gap-2">
              <div className="relative min-w-0 flex-1">
                <input
                  required
                  name="email"
                  type="email"
                  value={contributorQuery}
                  onChange={(event) => {
                    setContributorQuery(event.target.value);
                    setShowContributorCandidates(true);
                  }}
                  onFocus={() => setShowContributorCandidates(true)}
                  onBlur={() => window.setTimeout(() => setShowContributorCandidates(false), 150)}
                  placeholder="名前またはメールアドレスで検索"
                  autoComplete="off"
                  className="w-full rounded-xl border bg-card p-2"
                />
                {showContributorCandidates ? (
                  <div
                    id="contributor-candidates"
                    className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border bg-popover py-1 shadow-lg"
                  >
                    {contributorCandidates.state !== "idle" ? (
                      <p className="px-3 py-2 text-sm text-muted-foreground">検索中…</p>
                    ) : contributorCandidates.data?.candidates.length ? (
                      contributorCandidates.data.candidates.map((candidate) => (
                        <button
                          key={candidate.email}
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            setContributorQuery(candidate.email);
                            setShowContributorCandidates(false);
                          }}
                          className="block w-full px-3 py-2 text-left hover:bg-muted"
                        >
                          <span className="block text-sm font-medium">{candidate.name}</span>
                          <span className="block text-sm text-muted-foreground">
                            {candidate.email}
                          </span>
                        </button>
                      ))
                    ) : contributorQuery ? (
                      <p className="px-3 py-2 text-sm text-muted-foreground">
                        該当するユーザーはいません。
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
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
        {organizer ? (
          <section className="rounded-2xl border p-4">
            <h2 className="font-bold">Google Photos album</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              公開共有アルバムを監視して、投稿用の写真ライブラリに取り込みます。
            </p>
            <Form method="post" action="/settings/google-photos" className="mt-3 space-y-2">
              <input
                required
                name="albumUrl"
                type="url"
                defaultValue={loaderData.googlePhotosAlbum?.albumUrl}
                placeholder="https://photos.google.com/share/..."
                className="w-full rounded-xl border bg-card p-2"
              />
              <button
                className="rounded-full bg-primary px-3 py-2 text-sm font-bold text-white"
                type="submit"
              >
                アルバムを保存
              </button>
            </Form>
            {loaderData.googlePhotosAlbum ? (
              <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                <p>
                  {loaderData.googlePhotosAlbum.enabled ? "監視中" : "停止中"}・次回:{" "}
                  {new Date(loaderData.googlePhotosAlbum.nextPollAt).toLocaleString("ja-JP")}
                </p>
                {loaderData.googlePhotosAlbum.lastError ? (
                  <p className="text-red-500">{loaderData.googlePhotosAlbum.lastError}</p>
                ) : null}
                {loaderData.googlePhotosAlbum.enabled ? (
                  <Form method="post" action="/settings/google-photos">
                    <button type="submit" name="intent" value="disable" className="text-red-500">
                      監視を停止
                    </button>
                  </Form>
                ) : null}
                {loaderData.googlePhotosPollRuns.length ? (
                  <ul className="mt-2 space-y-1">
                    {loaderData.googlePhotosPollRuns.map((run) => (
                      <li key={run.id}>
                        {new Date(run.startedAt).toLocaleString("ja-JP")}: {run.outcome}
                        {run.importedCount ? ` (${run.importedCount} 件追加)` : ""}
                        {run.detail ? ` — ${run.detail}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}
