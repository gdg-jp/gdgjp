import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import { useEffect, useState } from "react";
import { Form, Link, useFetcher } from "react-router";
import { AppShell } from "~/components/app-shell";
import { requireSnsAccess } from "~/lib/access.server";
import {
  getGooglePhotosAlbum,
  listContributors,
  listGooglePhotosPollRuns,
  listXAccounts,
} from "~/lib/db.server";
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

export async function loader({ request, context }: Route.LoaderArgs) {
  const access = await requireSnsAccess(context.cloudflare.env, request);
  return {
    ...access,
    accounts: await listXAccounts(context.cloudflare.env.DB, access.chapter.chapterId),
    googlePhotosAlbum: await getGooglePhotosAlbum(
      context.cloudflare.env.DB,
      access.chapter.chapterId,
    ),
    googlePhotosPollRuns: await listGooglePhotosPollRuns(
      context.cloudflare.env.DB,
      access.chapter.chapterId,
    ),
    contributors:
      access.chapter.role === "organizer"
        ? await listContributors(context.cloudflare.env.DB, access.chapter.chapterId)
        : [],
  };
}
export default function Settings({ loaderData }: Route.ComponentProps) {
  const organizer = loaderData.chapter.role === "organizer";
  const [contributorQuery, setContributorQuery] = useState("");
  const [showContributorCandidates, setShowContributorCandidates] = useState(false);
  const debouncedContributorQuery = useDebouncedValue(contributorQuery);
  const contributorCandidates = useFetcher<{ candidates: ContributorCandidate[] }>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: fetcher functions are stable
  useEffect(() => {
    if (!organizer || !showContributorCandidates) return;
    contributorCandidates.load(
      `/api/contributor-candidates?q=${encodeURIComponent(debouncedContributorQuery)}`,
    );
  }, [debouncedContributorQuery, organizer, showContributorCandidates]);

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
        {organizer ? (
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
      </div>
    </AppShell>
  );
}

function RevokeXAccountDialog({ accountId, xUserId }: { accountId: string; xUserId: string }) {
  const [confirmation, setConfirmation] = useState("");
  const confirmed = confirmation === xUserId;

  return (
    <AlertDialogPrimitive.Root onOpenChange={(open) => !open && setConfirmation("")}>
      <AlertDialogPrimitive.Trigger asChild>
        <button type="button" className="text-sm text-red-500">
          解除
        </button>
      </AlertDialogPrimitive.Trigger>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 animation-duration-200 ease-out motion-reduce:animation-duration-100 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <AlertDialogPrimitive.Content className="fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-card p-6 shadow-lg outline-none animation-duration-200 ease-out motion-reduce:animation-duration-100 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:zoom-in-95">
          <div className="grid gap-1.5 text-center sm:text-left">
            <AlertDialogPrimitive.Title className="text-lg font-semibold">
              Xアカウントの認可を解除しますか？
            </AlertDialogPrimitive.Title>
            <AlertDialogPrimitive.Description className="text-sm text-muted-foreground">
              この操作は取り消せません。解除するには、次のX Account IDを入力してください: {xUserId}
            </AlertDialogPrimitive.Description>
          </div>
          <Form method="post" action="/settings/x" className="grid gap-4">
            <input type="hidden" name="id" value={accountId} />
            <input type="hidden" name="intent" value="revoke" />
            <input type="hidden" name="xUserId" value={confirmation} />
            <label
              className="grid gap-1.5 text-sm font-medium"
              htmlFor={`x-account-id-${accountId}`}
            >
              X Account ID
              <input
                id={`x-account-id-${accountId}`}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
                className="rounded-xl border bg-card p-2 font-normal"
              />
            </label>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <AlertDialogPrimitive.Cancel asChild>
                <button
                  type="button"
                  className="rounded-full border px-5 py-2 font-bold hover:bg-muted"
                >
                  キャンセル
                </button>
              </AlertDialogPrimitive.Cancel>
              <AlertDialogPrimitive.Action asChild>
                <button
                  type="submit"
                  disabled={!confirmed}
                  className="rounded-full bg-destructive px-5 py-2 font-bold text-destructive-foreground hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  削除する
                </button>
              </AlertDialogPrimitive.Action>
            </div>
          </Form>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
