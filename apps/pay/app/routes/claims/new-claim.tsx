import { Button, PageHeader } from "@gdgjp/design-system";
import { Form, Link } from "react-router";
import { Header } from "~/layouts/header";

import { redirect } from "react-router";

import { requireMember } from "~/features/auth/session.server";
import { todayJstDate } from "~/features/claims/money";
import { createClaim, getSelfClaim } from "~/features/claims/repository.server";
import { getEvent } from "~/features/events/repository.server";
import { getProfile } from "~/features/profiles/repository.server";
import { isEventId } from "~/lib/id";
import type { Route } from "./+types/new-claim";

export function meta() {
  return [{ title: "経費申請 — GDG Japan Pay" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  if (!isEventId(params.id)) throw new Response("Not Found", { status: 404 });
  const { user } = await requireMember(env, request);
  const event = await getEvent(env.DB, params.id);
  if (!event) throw new Response("Not Found", { status: 404 });
  const existing = await getSelfClaim(env.DB, event.id, user.id);
  if (existing) return redirect(`/events/${event.id}/claims/${existing.id}`);
  const profile = await getProfile(env.DB, env.TOKEN_ENCRYPTION_KEY, user.id);
  if (!profile) return redirect("/profile");
  return { user, event };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  if (!isEventId(params.id)) throw new Response("Not Found", { status: 404 });
  const { user } = await requireMember(env, request);
  const event = await getEvent(env.DB, params.id);
  if (!event) throw new Response("Not Found", { status: 404 });
  const existing = await getSelfClaim(env.DB, event.id, user.id);
  if (existing) return redirect(`/events/${event.id}/claims/${existing.id}`);
  const profile = await getProfile(env.DB, env.TOKEN_ENCRYPTION_KEY, user.id);
  if (!profile) return redirect("/profile");
  const claim = await createClaim(env.DB, env.TOKEN_ENCRYPTION_KEY, {
    eventId: event.id,
    kind: "self",
    userId: user.id,
    applicantName: profile.legalName,
    bank: profile.bank,
    applicationDate: todayJstDate(),
    createdBy: user.id,
  });
  return redirect(`/events/${event.id}/claims/${claim.id}`);
}

export default function NewClaimPage({ loaderData }: Route.ComponentProps) {
  const { user, event } = loaderData;
  return (
    <div className="min-h-dvh bg-background">
      <Header user={{ name: user.name, email: user.email, image: user.image }} />
      <main className="mx-auto max-w-xl space-y-6 px-4 py-6 sm:py-8">
        <PageHeader
          back={
            <Link to={`/events/${event.id}`} className="text-sm text-link hover:underline">
              {event.title}
            </Link>
          }
          title="経費を申請"
          description={<> {event.title} 向けの申請を作成し、領収書を追加します。 </>}
        />
        <Form method="post">
          <Button type="submit">申請を作成する</Button>
        </Form>
      </main>
    </div>
  );
}
