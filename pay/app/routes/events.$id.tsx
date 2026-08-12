import { Link } from "react-router";
import { Header } from "~/components/header";
import { Button } from "~/components/ui/button";
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

  return {
    user,
    event,
    canManage,
    canProxy,
    hasProfile: Boolean(profile),
    selfClaimId: selfClaim?.id ?? null,
    total: eventTotal(claims),
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
  const { user, event, canManage, canProxy, hasProfile, selfClaimId, total, claims } = loaderData;
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
