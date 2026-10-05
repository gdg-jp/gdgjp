import { Button, Card, PageHeader, Table } from "@gdgjp/design-system";
import { Link } from "react-router";
import { Header } from "~/layouts/header";

import { formatYen } from "~/features/claims/money";

import { getOptionalUser, requireMember } from "~/features/auth/session.server";

import { eventTotal, listClaimsForEvent } from "~/features/claims/repository.server";
import { listEvents } from "~/features/events/repository.server";
import type { Route } from "./+types/event-list";

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
    <div className="min-h-dvh bg-background">
      <Header user={user ? { name: user.name, email: user.email, image: user.image } : null} />
      <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-6 sm:py-8">
        <PageHeader
          title="GDG Japan Pay"
          description="イベント経費の申請・集計・スプレッドシート連携"
          actions={
            user ? (
              <>
                <Button variant="outline" asChild>
                  <Link to="/profile">口座情報</Link>
                </Button>
                <Button asChild>
                  <Link to="/events/new">イベント登録</Link>
                </Button>
              </>
            ) : (
              <Button asChild>
                <Link to="/signin">サインイン</Link>
              </Button>
            )
          }
        />

        {user ? (
          <section aria-label="イベント一覧">
            <Card className="p-0">
              <div className="border-b px-5 py-4">
                <h2 className="font-semibold">イベント一覧</h2>
              </div>
              {events.length === 0 ? (
                <p className="px-5 py-8 text-sm text-muted">
                  まだイベントがありません。最初のイベントを登録してください。
                </p>
              ) : (
                <Table scrollLabel="イベント一覧を横にスクロール">
                  <thead>
                    <tr>
                      <th scope="col">イベント</th>
                      <th scope="col">申請数</th>
                      <th scope="col">合計</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((event) => (
                      <tr key={event.id}>
                        <td>
                          <Link
                            className="font-medium text-link hover:underline"
                            to={`/events/${event.id}`}
                          >
                            {event.title}
                          </Link>
                        </td>
                        <td>{event.claimCount}</td>
                        <td>{formatYen(event.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          </section>
        ) : (
          <section aria-label="利用案内">
            <Card>
              <p className="text-sm text-muted">
                GDG Accounts
                でサインインすると、イベント登録と経費申請ができます。チャプターのメンバーシップが必要です。
              </p>
            </Card>
          </section>
        )}
      </main>
    </div>
  );
}
