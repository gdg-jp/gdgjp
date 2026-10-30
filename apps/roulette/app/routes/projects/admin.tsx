import {
  Alert,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Icons,
  PageHeader,
  Stack,
  Text,
  toast,
} from "@gdgjp/design-system";
import { useEffect, useState } from "react";
import { Link, useFetcher, useRevalidator } from "react-router";
import { DrawLogCard } from "~/features/draw/components/DrawLogCard";
import { listDraws } from "~/features/draw/draw.server";
import { ModeCard } from "~/features/prizes/components/ModeCard";
import { PrizeCard } from "~/features/prizes/components/PrizeCard";
import {
  type Draft,
  type DraftErrors,
  boxPool,
  draftToSettings,
  hasErrors,
  isDirty,
  parseDraft,
  previewOdds,
  toDraft,
  validateDraft,
} from "~/features/prizes/draft";
import { finiteLeft } from "~/features/prizes/odds";
import { requireProjectAccess } from "~/features/projects/access.server";
import { StatusCard } from "~/features/projects/components/StatusCard";
import { resetDraws, saveSettings, setOpen } from "~/features/projects/projects.server";
import { AdminLayout } from "~/layouts/AdminLayout";
import { useHydrated } from "~/lib/use-hydrated";
import type { Route } from "./+types/admin";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data ? `${data.project.name} — GDG Roulette` : "GDG Roulette" }];
}

/** The page polls, so it lists only the latest spins; the CSV has them all. */
const LOG_LIMIT = 50;

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { user, project } = await requireProjectAccess(env, request, params.slug);
  return {
    user: { name: user.name, email: user.email, image: user.image },
    accountsUrl: env.ACCOUNTS_URL,
    publicUrl: `${env.APP_URL}/${project.slug}`,
    project,
    log: await listDraws(env.DB, project.slug, LOG_LIMIT),
  };
}

type Intent =
  | { intent: "save"; draft: Draft }
  | { intent: "open"; open: boolean }
  | { intent: "reset" };

export async function action({ request, params, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const { project } = await requireProjectAccess(env, request, params.slug);
  // Untrusted: every field is checked below (the draft by parseDraft).
  const body = (await request.json().catch(() => null)) as Intent | null;
  if (body?.intent === "open" && typeof body.open === "boolean") {
    await setOpen(env.DB, project.slug, body.open);
    return { intent: "open", open: body.open } as const;
  }
  if (body?.intent === "reset") {
    await resetDraws(env.DB, project.slug);
    return { intent: "reset" } as const;
  }
  if (body?.intent === "save") {
    const draft = parseDraft(body.draft);
    if (!draft) throw new Response("Bad Request", { status: 400 });
    const errors = validateDraft(draft, project.prizes);
    if (hasErrors(errors)) return { intent: "save", errors } as const;
    const result = await saveSettings(env.DB, project, draftToSettings(draft, project.prizes));
    if (!result.ok) {
      const conflict: DraftErrors = {
        list: "保存中に抽選が進みました。個数を確かめて、もう一度保存してください",
      };
      return { intent: "save", errors: conflict } as const;
    }
    return { intent: "save", errors: {} } as const;
  }
  throw new Response("Bad Request", { status: 400 });
}

/** While the page is visible, refresh the counters every so often. */
function usePolling(ms: number) {
  const { revalidate, state } = useRevalidator();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && state === "idle") void revalidate();
    }, ms);
    return () => clearInterval(timer);
  }, [ms, revalidate, state]);
}

export default function AdminPage({ loaderData }: Route.ComponentProps) {
  const { user, accountsUrl, publicUrl, project, log } = loaderData;
  const save = useFetcher<typeof action>();
  const toggle = useFetcher<typeof action>();
  const reset = useFetcher<typeof action>();
  const [draft, setDraft] = useState<Draft>(() => toDraft(project));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [revision, setRevision] = useState(project.revision);
  const [resetOpen, setResetOpen] = useState(false);
  const hydrated = useHydrated();
  usePolling(15_000);

  // A save (here or by another organizer) bumps the revision: start over from it.
  if (project.revision !== revision) {
    setRevision(project.revision);
    setDraft(toDraft(project));
    setErrors({});
  }

  useEffect(() => {
    const data = save.data;
    if (data?.intent !== "save") return;
    setErrors(data.errors);
    if (!hasErrors(data.errors)) toast.success("変更を保存しました");
  }, [save.data]);

  useEffect(() => {
    if (toggle.data?.intent === "open")
      toast.success(toggle.data.open ? "抽選の受付を始めました" : "抽選の受付を止めました");
  }, [toggle.data]);

  useEffect(() => {
    if (reset.data?.intent === "reset") toast.success("抽選結果をリセットしました");
  }, [reset.data]);

  const submit = (fetcher: typeof save, body: Intent) =>
    fetcher.submit(body, { method: "post", encType: "application/json" });

  const saved = toDraft(project);
  const dirty = isDirty(draft, saved);
  const open =
    toggle.state !== "idle" &&
    toggle.json &&
    typeof toggle.json === "object" &&
    "open" in toggle.json
      ? Boolean(toggle.json.open)
      : project.open;
  const wonOf = (id: string) => project.prizes.find((prize) => prize.id === id)?.won ?? 0;
  const onboarding =
    project.draws === 0 && !project.open && project.prizes.every((prize) => prize.stock === null);

  return (
    <AdminLayout user={user} accountsUrl={accountsUrl}>
      <Stack className="[word-break:auto-phrase]">
        <PageHeader
          back={
            <Button variant="ghost" size="sm" asChild>
              <Link to="/">
                <Icons name="ArrowLeft" size={16} aria-hidden="true" />
                プロジェクト一覧
              </Link>
            </Button>
          }
          title={project.name}
          description={`${publicUrl.replace(/^https?:\/\//, "")} · ${project.chapterSlug}`}
          actions={
            <>
              {dirty && (
                <Text size="sm" tone="muted">
                  未保存の変更があります
                </Text>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton variant="ghost" aria-label="その他の操作" disabled={!hydrated}>
                    <Icons name="MoreHorizontal" size={18} aria-hidden="true" />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setResetOpen(true)}>
                    抽選結果をリセット
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                disabled={!hydrated}
                loading={save.state !== "idle"}
                onClick={() => {
                  const found = validateDraft(draft, project.prizes);
                  setErrors(found);
                  if (!hasErrors(found)) submit(save, { intent: "save", draft });
                }}
              >
                変更を保存
              </Button>
            </>
          }
        />
        {onboarding && (
          <Alert tone="info" title="景品を登録して、受付を始めましょう">
            景品を入れて「変更を保存」を押し、「抽選を受け付ける」をオンにすると、抽選画面で回せるようになります。
          </Alert>
        )}
        <StatusCard
          open={open}
          draws={project.draws}
          left={finiteLeft(project.prizes)}
          slug={project.slug}
          publicUrl={publicUrl}
          pending={!hydrated || toggle.state !== "idle"}
          onToggleOpen={(next) => submit(toggle, { intent: "open", open: next })}
          onCopy={() => {
            navigator.clipboard.writeText(publicUrl).then(
              () => toast.success("URL をコピーしました"),
              () => toast.error("コピーできませんでした。URL を選択してコピーしてください"),
            );
          }}
        />
        <ModeCard
          draft={draft}
          errors={errors}
          pool={boxPool(draft, project.prizes, project.draws)}
          onChange={setDraft}
        />
        <PrizeCard
          draft={draft}
          errors={errors}
          odds={previewOdds(draft, project.prizes, project.draws)}
          wonOf={wonOf}
          onChange={setDraft}
        />
        <DrawLogCard
          entries={log}
          total={project.draws}
          csvUrl={`/admin/${project.slug}/draws.csv`}
        />
      </Stack>
      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogTitle>抽選結果をリセットしますか？</AlertDialogTitle>
          <AlertDialogDescription>
            抽選回数と当選数を 0
            に戻し、抽選ログと、来場者の端末の「抽選済み」の記録も消します。景品と抽選モードはそのままです。この操作は取り消せません。
          </AlertDialogDescription>
          <div className="flex justify-end gap-3">
            <AlertDialogCancel asChild>
              <Button variant="outline">キャンセル</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button variant="danger" onClick={() => submit(reset, { intent: "reset" })}>
                リセットする
              </Button>
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
}
