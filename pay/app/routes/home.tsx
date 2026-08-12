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
import { getOptionalUser, requireMember } from "~/lib/auth-redirect.server";
import { eventTotal, listClaimsForEvent, listEvents } from "~/lib/db.server";
import { formatYen } from "~/lib/money";
import type { Route } from "./+types/home";

export function meta() {
  return [{ title: "GDG Japan Pay" }, { name: "description", content: "GDG イベント経費精算" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const optional = await getOptionalUser(env, request);
  if (!optional) {
    return {
      user: null as null,
      events: [] as Array<{
        id: string;
        title: string;
        total: number;
        claimCount: number;
        createdAt: number;
      }>,
    };
  }
  const { user } = await requireMember(env, request);
  const events = await listEvents(env.DB);
  const enriched = await Promise.all(
    events.map(async (event) => {
      const claims = await listClaimsForEvent(env.DB, event.id);
      return {
        id: event.id,
        title: event.title,
        total: eventTotal(claims),
        claimCount: claims.length,
        createdAt: event.createdAt,
      };
    }),
  );
  return { user, events: enriched };
}

export default function HomePage({ loaderData }: Route.ComponentProps) {
  const { user, events } = loaderData;
  return (
    <div className="min-h-dvh bg-[radial-gradient(circle_at_top,_#dbeafe,_transparent_45%),linear-gradient(180deg,#f8fafc,#eef2ff)] dark:bg-[radial-gradient(circle_at_top,_#1e3a5f,_transparent_40%),linear-gradient(180deg,#0b1220,#111827)]">
      <Header user={user ? { name: user.name, email: user.email, image: user.image } : null} />
      <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-10">
        <div className="space-y-3">
          <p className="text-sm font-medium tracking-[0.2em] text-blue-700 uppercase dark:text-blue-300">
            pay.gdgs.jp
          </p>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">GDG Japan Pay</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                イベント経費の申請・集計・スプレッドシート連携
              </p>
            </div>
            {user ? (
              <div className="flex gap-2">
                <Button variant="outline" asChild>
                  <Link to="/profile">口座情報</Link>
                </Button>
                <Button asChild>
                  <Link to="/events/new">イベント登録</Link>
                </Button>
              </div>
            ) : (
              <Button asChild>
                <Link to="/signin">サインイン</Link>
              </Button>
            )}
          </div>
        </div>

        {user ? (
          <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/80 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/70">
            <div className="border-b px-5 py-4">
              <h2 className="font-semibold">イベント一覧</h2>
            </div>
            {events.length === 0 ? (
              <p className="px-5 py-8 text-sm text-muted-foreground">
                まだイベントがありません。最初のイベントを登録してください。
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>イベント</TableHead>
                    <TableHead>申請数</TableHead>
                    <TableHead>合計</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell>
                        <Link
                          className="font-medium text-primary hover:underline"
                          to={`/events/${event.id}`}
                        >
                          {event.title}
                        </Link>
                      </TableCell>
                      <TableCell>{event.claimCount}</TableCell>
                      <TableCell>{formatYen(event.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
        ) : (
          <section className="rounded-2xl border border-slate-200/80 bg-white/70 p-6 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/60">
            <p className="text-sm text-muted-foreground">
              GDG Accounts
              でサインインすると、イベント登録と経費申請ができます。チャプターのメンバーシップが必要です。
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
