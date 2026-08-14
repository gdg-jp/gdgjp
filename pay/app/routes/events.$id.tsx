import { useCallback } from "react";
import { Link, useFetcher } from "react-router";
import { GoogleDrivePickerButton } from "~/components/google-drive-picker";
import { Header } from "~/components/header";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { canProxyForEvent, canViewAllClaims, requireMember } from "~/lib/auth-redirect.server";
import {
  eventTotal,
  getEvent,
  getGoogleOAuthToken,
  getProfile,
  getSelfClaim,
  listClaimsForEvent,
} from "~/lib/db.server";
import { isEventId } from "~/lib/id";
import { formatYen } from "~/lib/money";
import type { Route } from "./+types/events.$id";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.event ? `${data.event.title} — Pay` : "Event — Pay" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  if (!isEventId(params.id)) throw new Response("Not Found", { status: 404 });
  const { user, chapters } = await requireMember(env, request);
  const event = await getEvent(env.DB, params.id);
  if (!event) throw new Response("Not Found", { status: 404 });

  const actor = { userId: user.id, chapters };
  const canManage = canViewAllClaims(actor, event);
  const canProxy = canProxyForEvent(actor, event);
  const claims = await listClaimsForEvent(env.DB, event.id);
  const visibleClaims = canManage ? claims : claims.filter((claim) => claim.user_id === user.id);
  const selfClaim = await getSelfClaim(env.DB, event.id, user.id);
  const profile = await getProfile(env.DB, env.TOKEN_ENCRYPTION_KEY, user.id);
  const googleToken = event.googleAdminUserId
    ? await getGoogleOAuthToken(env.DB, event.googleAdminUserId)
    : null;

  return {
    user,
    event,
    canManage,
    canProxy,
    hasProfile: Boolean(profile),
    selfClaimId: selfClaim?.id ?? null,
    total: eventTotal(claims),
    google: {
      adminUserId: event.googleAdminUserId,
      adminEmail: googleToken?.googleEmail ?? null,
      isCurrentUserAdmin: event.googleAdminUserId === user.id,
      templateGranted: Boolean(googleToken?.templateGrantedAt),
      folderId: event.googleDriveFolderId,
      folderName: event.googleDriveFolderName,
      pickerApiKey: env.GOOGLE_PICKER_API_KEY,
      templateSpreadsheetId: env.SHEETS_TEMPLATE_ID,
    },
    claims: visibleClaims.map((claim) => ({
      id: claim.id,
      kind: claim.kind,
      applicantName: claim.applicant_name,
      totalAmount: claim.total_amount,
      status: claim.status,
      sheetUrl: claim.sheet_url,
      emailSentAt: claim.email_sent_at,
    })),
  };
}

type GoogleConnectionInfo = {
  adminUserId: string | null;
  adminEmail: string | null;
  isCurrentUserAdmin: boolean;
  templateGranted: boolean;
  folderId: string | null;
  folderName: string | null;
  pickerApiKey: string;
  templateSpreadsheetId: string;
};

function GoogleConnectionCard({
  eventId,
  google,
}: {
  eventId: string;
  google: GoogleConnectionInfo;
}) {
  const fetcher = useFetcher();

  const getAccessToken = useCallback(async () => {
    const res = await fetch(`/events/${eventId}/google`, {
      method: "POST",
      body: new URLSearchParams({ intent: "access-token" }),
    });
    const json = (await res.json()) as { accessToken?: string; error?: string };
    if (!res.ok || !json.accessToken) {
      throw new Error(json.error ?? "アクセストークンの取得に失敗しました");
    }
    return json.accessToken;
  }, [eventId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Google連携</CardTitle>
        <CardDescription>
          スプレッドシートへの反映には、イベント管理者本人のGoogleアカウントとの連携が必要です。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!google.adminUserId ? (
          <div className="space-y-2">
            <p className="text-muted-foreground">まだGoogle連携されていません。</p>
            <Button asChild size="sm">
              <a href={`/google/connect?event_id=${eventId}`}>自分のGoogleアカウントで連携する</a>
            </Button>
          </div>
        ) : !google.isCurrentUserAdmin ? (
          <div className="space-y-2">
            <p>
              連携アカウント: <span className="font-medium">{google.adminEmail ?? "取得中"}</span>
            </p>
            <p className="text-muted-foreground">
              テンプレート・フォルダの設定は連携した本人のみ変更できます。自分に切り替えるには再連携してください。
            </p>
            <Button asChild size="sm" variant="outline">
              <a href={`/google/connect?event_id=${eventId}`}>自分で連携し直す</a>
            </Button>
          </div>
        ) : (
          <>
            <p>
              連携アカウント: <span className="font-medium">{google.adminEmail}</span>
            </p>
            <div className="space-y-1">
              <p>テンプレートへのアクセス: {google.templateGranted ? "許可済み" : "未許可"}</p>
              <p className="text-muted-foreground">
                <a
                  className="underline"
                  href={`https://docs.google.com/spreadsheets/d/${google.templateSpreadsheetId}/edit`}
                  target="_blank"
                  rel="noreferrer"
                >
                  テンプレートを開いて確認する
                </a>
                （Pickerで同じファイルを選択してください）
              </p>
              <GoogleDrivePickerButton
                mode="template"
                pickerApiKey={google.pickerApiKey}
                getAccessToken={getAccessToken}
                label={google.templateGranted ? "テンプレートを選び直す" : "テンプレートを選択"}
                onPicked={() => {
                  fetcher.submit(
                    { intent: "grant-template" },
                    { method: "post", action: `/events/${eventId}/google` },
                  );
                }}
              />
            </div>
            <div className="space-y-1">
              <p>共有フォルダ: {google.folderName ?? "未設定"}</p>
              <GoogleDrivePickerButton
                mode="folder"
                pickerApiKey={google.pickerApiKey}
                getAccessToken={getAccessToken}
                label={google.folderId ? "フォルダを選び直す" : "フォルダを選択"}
                onPicked={(item) => {
                  fetcher.submit(
                    { intent: "set-folder", folderId: item.id, folderName: item.name },
                    { method: "post", action: `/events/${eventId}/google` },
                  );
                }}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function EventDetailPage({ loaderData }: Route.ComponentProps) {
  const { user, event, canManage, canProxy, hasProfile, selfClaimId, total, claims, google } =
    loaderData;
  return (
    <div className="min-h-dvh bg-background">
      <Header user={{ name: user.name, email: user.email, image: user.image }} />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">
              <Link to="/" className="hover:underline">
                イベント一覧
              </Link>
            </p>
            <h1 className="mt-1 text-2xl font-semibold">{event.title}</h1>
            <p className="mt-2 text-lg font-medium">合計 {formatYen(total)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {selfClaimId ? (
              <Button asChild>
                <Link to={`/events/${event.id}/claims/${selfClaimId}`}>自分の申請</Link>
              </Button>
            ) : hasProfile ? (
              <Button asChild>
                <Link to={`/events/${event.id}/claims/new`}>経費を申請</Link>
              </Button>
            ) : (
              <Button disabled>経費を申請</Button>
            )}
            {canProxy ? (
              <Button variant="outline" asChild>
                <Link to={`/events/${event.id}/claims/proxy`}>代行登録</Link>
              </Button>
            ) : null}
          </div>
        </div>

        {!hasProfile ? (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
            申請前に{" "}
            <Link to="/profile" className="underline">
              本名と口座情報
            </Link>{" "}
            を登録してください。
          </p>
        ) : null}

        {canManage ? <GoogleConnectionCard eventId={event.id} google={google} /> : null}

        <section className="overflow-hidden rounded-xl border">
          <div className="border-b px-4 py-3">
            <h2 className="font-semibold">{canManage ? "すべての申請" : "自分の申請"}</h2>
          </div>
          {claims.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">まだ申請がありません。</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>申請者</TableHead>
                  <TableHead>種別</TableHead>
                  <TableHead>合計</TableHead>
                  <TableHead>状態</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {claims.map((claim) => (
                  <TableRow key={claim.id}>
                    <TableCell>{claim.applicantName}</TableCell>
                    <TableCell>{claim.kind === "proxy" ? "代行" : "本人"}</TableCell>
                    <TableCell>{formatYen(claim.totalAmount)}</TableCell>
                    <TableCell>
                      {claim.status === "synced" ? "Sheets同期済" : "下書き"}
                      {claim.emailSentAt ? " / メール送信済" : ""}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link to={`/events/${event.id}/claims/${claim.id}`}>開く</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      </main>
    </div>
  );
}
