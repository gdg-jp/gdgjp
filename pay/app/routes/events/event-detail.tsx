import { Alert, Button, Card, PageHeader, Table } from "@gdgjp/design-system";
import { Link } from "react-router";
import { Header } from "~/layouts/header";

import { formatYen } from "~/features/claims/money";

import { GoogleConnectionCard } from "~/features/google/components/google-connection-card";

import { requireMember } from "~/features/auth/session.server";

import { eventTotal, getSelfClaim, listClaimsForEvent } from "~/features/claims/repository.server";
import { canProxyForEvent, canViewAllClaims } from "~/features/events/permissions";
import { getEvent } from "~/features/events/repository.server";

import { getGoogleOAuthToken } from "~/features/google/repository.server";
import { getProfile } from "~/features/profiles/repository.server";
import { isEventId } from "~/lib/id";
import type { Route } from "./+types/event-detail";

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
      pickerAppId: env.GOOGLE_PICKER_APP_ID,
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

export default function EventDetailPage({ loaderData }: Route.ComponentProps) {
  const { user, event, canManage, canProxy, hasProfile, selfClaimId, total, claims, google } =
    loaderData;
  return (
    <div className="min-h-dvh bg-background">
      <Header user={{ name: user.name, email: user.email, image: user.image }} />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:py-8">
        <PageHeader
          title={event.title}
          description={<>合計 {formatYen(total)}</>}
          back={
            <Link to="/" className="text-sm text-link hover:underline">
              イベント一覧
            </Link>
          }
          actions={
            <>
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
            </>
          }
        />

        {!hasProfile ? (
          <Alert tone="warning" title="口座情報の登録が必要です">
            申請前に{" "}
            <Link to="/profile" className="underline">
              本名と口座情報
            </Link>{" "}
            を登録してください。
          </Alert>
        ) : null}

        {canManage ? <GoogleConnectionCard eventId={event.id} google={google} /> : null}

        <section aria-label="申請一覧">
          <Card className="p-0">
            <div className="border-b px-4 py-3">
              <h2 className="font-semibold">{canManage ? "すべての申請" : "自分の申請"}</h2>
            </div>
            {claims.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted">まだ申請がありません。</p>
            ) : (
              <Table scrollLabel="申請一覧を横にスクロール">
                <thead>
                  <tr>
                    <th scope="col">申請者</th>
                    <th scope="col">種別</th>
                    <th scope="col">合計</th>
                    <th scope="col">状態</th>
                    <th scope="col">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {claims.map((claim) => (
                    <tr key={claim.id}>
                      <td>{claim.applicantName}</td>
                      <td>{claim.kind === "proxy" ? "代行" : "本人"}</td>
                      <td>{formatYen(claim.totalAmount)}</td>
                      <td>
                        {claim.status === "synced" ? "Sheets同期済" : "下書き"}
                        {claim.emailSentAt ? " / メール送信済" : ""}
                      </td>
                      <td className="text-right">
                        <Button variant="ghost" size="sm" asChild>
                          <Link to={`/events/${event.id}/claims/${claim.id}`}>開く</Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </section>
      </main>
    </div>
  );
}
