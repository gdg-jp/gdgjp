import { Check, Pencil, Trash2 } from "lucide-react";
import { Form, Link, redirect, useLoaderData } from "react-router";
import { Header } from "~/components/header";
import { SlotPillGrid } from "~/components/slot-pill-grid";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { getOptionalUser } from "~/lib/auth-redirect.server";
import {
  type Participant,
  createParticipant,
  findParticipantByUser,
  getEventBundle,
  setAvailability,
} from "~/lib/db";
import {
  hashToken,
  parseFromHeader,
  randomToken,
  serializeCookie,
  verify,
} from "~/lib/participant-cookie";
import { DAY_LABELS } from "~/lib/slots";
import { parseSlotIds } from "~/lib/validate";
import type { Route } from "./+types/e.$id";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.event ? `${data.event.title} — Scheduler` : "Scheduler" }];
}

async function resolveCurrentParticipant(
  env: Env,
  request: Request,
  eventId: string,
  participants: Participant[],
): Promise<Participant | null> {
  const user = await getOptionalUser(env, request);
  if (user) {
    const byUser = participants.find((p) => p.userId === user.id);
    return byUser ?? null;
  }
  const parsed = parseFromHeader(request.headers.get("Cookie"), eventId);
  if (!parsed) return null;
  const candidate = participants.find((p) => p.id === parsed.participantId);
  if (!candidate || !candidate.editTokenHash) return null;
  const hashed = await hashToken(parsed.token);
  if (!verify(hashed, candidate.editTokenHash)) return null;
  return candidate;
}

export async function loader(args: Route.LoaderArgs) {
  const env = args.context.cloudflare.env;
  const bundle = await getEventBundle(env.DB, args.params.id);
  if (!bundle) throw new Response("Not found", { status: 404 });
  const user = await getOptionalUser(env, args.request);
  const current = await resolveCurrentParticipant(
    env,
    args.request,
    bundle.event.id,
    bundle.participants,
  );
  const own = current
    ? new Set(
        bundle.availabilities.filter((a) => a.participantId === current.id).map((a) => a.slotId),
      )
    : new Set<number>();
  return {
    user: user ? { name: user.name, email: user.email } : null,
    isOwner: !!user && user.id === bundle.event.ownerUserId,
    event: bundle.event,
    slots: bundle.slots,
    participants: bundle.participants,
    availabilities: bundle.availabilities,
    currentParticipantId: current?.id ?? null,
    currentParticipantName: current?.displayName ?? null,
    ownSlotIds: Array.from(own),
  };
}

export async function action(args: Route.ActionArgs) {
  const env = args.context.cloudflare.env;
  const eventId = args.params.id;
  const bundle = await getEventBundle(env.DB, eventId);
  if (!bundle) throw new Response("Not found", { status: 404 });

  const form = await args.request.formData();
  const intent = form.get("intent");
  const validSlotIds = new Set(bundle.slots.map((s) => s.id));
  const requested = parseSlotIds(form).filter((id) => validSlotIds.has(id));

  const user = await getOptionalUser(env, args.request);

  if (intent === "update") {
    const current = await resolveCurrentParticipant(
      env,
      args.request,
      eventId,
      bundle.participants,
    );
    if (!current) throw new Response("Not joined", { status: 403 });
    await setAvailability(env.DB, current.id, requested);
    return redirect(`/e/${eventId}`);
  }

  if (intent === "join") {
    if (user) {
      const existing = await findParticipantByUser(env.DB, eventId, user.id);
      const participant =
        existing ??
        (await createParticipant(env.DB, {
          eventId,
          userId: user.id,
          displayName: user.name || user.email,
          editTokenHash: null,
        }));
      await setAvailability(env.DB, participant.id, requested);
      return redirect(`/e/${eventId}`);
    }
    const displayName = (form.get("displayName") ?? "").toString().trim();
    if (!displayName) throw new Response("Name is required", { status: 400 });
    const token = randomToken();
    const editTokenHash = await hashToken(token);
    const participant = await createParticipant(env.DB, {
      eventId,
      userId: null,
      displayName: displayName.slice(0, 100),
      editTokenHash,
    });
    await setAvailability(env.DB, participant.id, requested);
    const secure = new URL(args.request.url).protocol === "https:";
    return redirect(`/e/${eventId}`, {
      headers: {
        "Set-Cookie": serializeCookie(eventId, participant.id, token, { secure }),
      },
    });
  }

  throw new Response("Unknown intent", { status: 400 });
}

function formatLength(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

export default function EventPage() {
  const data = useLoaderData<typeof loader>();
  const {
    user,
    isOwner,
    event,
    slots,
    participants,
    availabilities,
    currentParticipantId,
    currentParticipantName,
    ownSlotIds,
  } = data;

  const slotByDayTime = new Map<string, (typeof slots)[number]>();
  for (const s of slots) slotByDayTime.set(`${s.dayOfWeek}-${s.startTime}`, s);
  const usedDays = [...new Set(slots.map((s) => s.dayOfWeek))].sort((a, b) => a - b);
  const allTimes = [...new Set(slots.map((s) => s.startTime))].sort();

  const availByParticipant = new Map<number, Set<number>>();
  for (const a of availabilities) {
    let set = availByParticipant.get(a.participantId);
    if (!set) {
      set = new Set();
      availByParticipant.set(a.participantId, set);
    }
    set.add(a.slotId);
  }
  const totals = new Map<number, number>();
  for (const s of slots) {
    let n = 0;
    for (const set of availByParticipant.values()) if (set.has(s.id)) n++;
    totals.set(s.id, n);
  }
  const ownSet = new Set(ownSlotIds);

  return (
    <div className="min-h-dvh">
      <Header user={user} />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-6 flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{event.title}</h1>
              {event.description ? (
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                  {event.description}
                </p>
              ) : null}
              <p className="mt-2 text-xs text-muted-foreground">
                Each meeting is {formatLength(event.slotMinutes)}.
              </p>
            </div>
            {isOwner ? (
              <div className="flex shrink-0 items-center gap-1">
                <Button variant="ghost" size="sm" asChild>
                  <Link to={`/e/${event.id}/edit`}>
                    <Pencil className="size-4" />
                    Edit
                  </Link>
                </Button>
                <Form
                  method="post"
                  action={`/e/${event.id}/delete`}
                  onSubmit={(e) => {
                    if (!confirm("Delete this event?")) e.preventDefault();
                  }}
                >
                  <Button type="submit" variant="ghost" size="sm">
                    <Trash2 className="size-4" />
                    Delete
                  </Button>
                </Form>
              </div>
            ) : null}
          </div>
          <ShareUrl path={`/e/${event.id}`} />
        </div>

        <section className="mb-8 rounded-md border p-4">
          <h2 className="text-lg font-semibold">
            {currentParticipantId ? "Update your availability" : "Pick the times that work"}
          </h2>
          {currentParticipantName ? (
            <p className="mt-1 text-sm text-muted-foreground">
              Participating as <span className="font-medium">{currentParticipantName}</span>
            </p>
          ) : null}
          <Form method="post" className="mt-4 flex flex-col gap-4">
            <input type="hidden" name="intent" value={currentParticipantId ? "update" : "join"} />
            {!currentParticipantId && !user ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="displayName">Your name</Label>
                <Input
                  id="displayName"
                  name="displayName"
                  required
                  maxLength={100}
                  placeholder="Alice"
                />
              </div>
            ) : null}
            <SlotPillGrid
              mode="interactive"
              usedDays={usedDays}
              allTimes={allTimes}
              slotByDayTime={slotByDayTime}
              ownSet={ownSet}
              totals={totals}
              totalParticipants={participants.length}
            />
            <div>
              <Button type="submit">{currentParticipantId ? "Update" : "Join"}</Button>
            </div>
          </Form>
        </section>

        {participants.length > 0 ? (
          <section>
            <h2 className="mb-2 text-sm font-medium text-muted-foreground">Who's available</h2>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Slot</TableHead>
                    {participants.map((p) => (
                      <TableHead key={p.id} className="text-center">
                        {p.displayName}
                      </TableHead>
                    ))}
                    <TableHead className="text-center">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {slots.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">
                        {DAY_LABELS[s.dayOfWeek]} {s.startTime}
                      </TableCell>
                      {participants.map((p) => {
                        const has = availByParticipant.get(p.id)?.has(s.id) ?? false;
                        return (
                          <TableCell key={p.id} className="text-center">
                            {has ? <Check className="mx-auto size-4 text-primary" /> : null}
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-center text-muted-foreground">
                        {totals.get(s.id) ?? 0}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}

function ShareUrl({ path }: { path: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs">
      <span className="text-muted-foreground">Share:</span>
      <code className="truncate">{path}</code>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          if (typeof window !== "undefined") {
            void navigator.clipboard.writeText(window.location.href);
          }
        }}
      >
        Copy
      </Button>
    </div>
  );
}
