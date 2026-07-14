import { Check, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Form, Link, data, useFetcher, useLoaderData } from "react-router";
import { toast } from "sonner";
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
  deleteParticipant,
  findParticipantByUser,
  getEventBundle,
  setAvailability,
} from "~/lib/db";
import {
  clearCookie,
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
    user: user ? { name: user.name, email: user.email, image: user.image } : null,
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
    return data({ ok: true as const, kind: "updated" as const });
  }

  if (intent === "delete-response") {
    const current = await resolveCurrentParticipant(
      env,
      args.request,
      eventId,
      bundle.participants,
    );
    if (!current) throw new Response("Not joined", { status: 403 });
    await deleteParticipant(env.DB, current.id);
    const headers: HeadersInit = {};
    if (!current.userId) {
      const secure = new URL(args.request.url).protocol === "https:";
      headers["Set-Cookie"] = clearCookie(eventId, { secure });
    }
    return data({ ok: true as const, kind: "deleted" as const }, { headers });
  }

  if (intent === "admin-delete-participant") {
    if (!user || user.id !== bundle.event.ownerUserId) {
      throw new Response("Forbidden", { status: 403 });
    }
    const participantId = Number.parseInt((form.get("participantId") ?? "").toString(), 10);
    const target = bundle.participants.find((p) => p.id === participantId);
    if (!target) throw new Response("Participant not found", { status: 404 });
    await deleteParticipant(env.DB, target.id);
    return data({ ok: true as const, kind: "admin-deleted" as const });
  }

  if (intent === "admin-restore-participant") {
    if (!user || user.id !== bundle.event.ownerUserId) {
      throw new Response("Forbidden", { status: 403 });
    }
    const displayName = (form.get("displayName") ?? "").toString().trim();
    if (!displayName) throw new Response("Name is required", { status: 400 });
    const targetUserId = (form.get("userId") ?? "").toString().trim() || null;
    let participant: Participant;
    if (targetUserId) {
      const existing = await findParticipantByUser(env.DB, eventId, targetUserId);
      participant =
        existing ??
        (await createParticipant(env.DB, {
          eventId,
          userId: targetUserId,
          displayName: displayName.slice(0, 100),
          editTokenHash: null,
        }));
    } else {
      // Anonymous restore: original cookie is unrecoverable, so the new
      // participant gets an orphan edit-token hash that no client holds.
      const editTokenHash = await hashToken(randomToken());
      participant = await createParticipant(env.DB, {
        eventId,
        userId: null,
        displayName: displayName.slice(0, 100),
        editTokenHash,
      });
    }
    await setAvailability(env.DB, participant.id, requested);
    return data({ ok: true as const, kind: "admin-restored" as const });
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
      return data({ ok: true as const, kind: "joined" as const });
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
    return data(
      { ok: true as const, kind: "joined" as const },
      {
        headers: {
          "Set-Cookie": serializeCookie(eventId, participant.id, token, { secure }),
        },
      },
    );
  }

  throw new Response("Unknown intent", { status: 400 });
}

function formatLength(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

export default function EventPage() {
  const loaderData = useLoaderData<typeof loader>();
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
  } = loaderData;

  const saveFetcher = useFetcher<typeof action>();
  const deleteFetcher = useFetcher<typeof action>();
  const adminFetcher = useFetcher<typeof action>();
  const joinFormRef = useRef<HTMLFormElement>(null);
  const snapshotRef = useRef<{ displayName: string; slotIds: number[] } | null>(null);
  const adminSnapshotRef = useRef<{
    displayName: string;
    userId: string | null;
    slotIds: number[];
  } | null>(null);
  const suppressNextSaveToastRef = useRef(false);
  const savePrevStateRef = useRef(saveFetcher.state);
  const deletePrevStateRef = useRef(deleteFetcher.state);
  const adminPrevStateRef = useRef(adminFetcher.state);

  function restore() {
    const snap = snapshotRef.current;
    if (!snap) return;
    snapshotRef.current = null;
    suppressNextSaveToastRef.current = true;
    const fd = new FormData();
    fd.set("intent", "join");
    fd.set("displayName", snap.displayName);
    for (const id of snap.slotIds) fd.append("slot_id", String(id));
    saveFetcher.submit(fd, { method: "post" });
  }

  function adminDelete(p: Participant, slotIdsForP: number[]) {
    adminSnapshotRef.current = {
      displayName: p.displayName,
      userId: p.userId,
      slotIds: slotIdsForP,
    };
    const fd = new FormData();
    fd.set("intent", "admin-delete-participant");
    fd.set("participantId", String(p.id));
    adminFetcher.submit(fd, { method: "post" });
  }

  function adminRestore(snap: { displayName: string; userId: string | null; slotIds: number[] }) {
    const fd = new FormData();
    fd.set("intent", "admin-restore-participant");
    fd.set("displayName", snap.displayName);
    if (snap.userId) fd.set("userId", snap.userId);
    for (const id of snap.slotIds) fd.append("slot_id", String(id));
    adminFetcher.submit(fd, { method: "post" });
  }

  useEffect(() => {
    const prev = savePrevStateRef.current;
    savePrevStateRef.current = saveFetcher.state;
    if (prev === "submitting" && saveFetcher.data?.kind === "joined" && !user) {
      joinFormRef.current?.reset();
    }
    if (prev !== "idle" && saveFetcher.state === "idle" && saveFetcher.data) {
      if (suppressNextSaveToastRef.current) {
        suppressNextSaveToastRef.current = false;
        toast.success("Availability restored");
      } else if (saveFetcher.data.kind === "joined") {
        toast.success("Joined event");
      } else if (saveFetcher.data.kind === "updated") {
        toast.success("Availability updated");
      }
    }
  }, [saveFetcher.state, saveFetcher.data, user]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: restore is stable enough; we only fire on state transitions
  useEffect(() => {
    if (
      deletePrevStateRef.current !== "idle" &&
      deleteFetcher.state === "idle" &&
      deleteFetcher.data?.kind === "deleted"
    ) {
      toast("Removed your availability", {
        action: { label: "Undo", onClick: restore },
      });
    }
    deletePrevStateRef.current = deleteFetcher.state;
  }, [deleteFetcher.state, deleteFetcher.data]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: adminRestore is stable enough; only fires on state transitions
  useEffect(() => {
    const prev = adminPrevStateRef.current;
    adminPrevStateRef.current = adminFetcher.state;
    if (prev === "idle" || adminFetcher.state !== "idle") return;
    const kind = adminFetcher.data?.kind;
    if (kind === "admin-deleted") {
      const snap = adminSnapshotRef.current;
      const name = snap?.displayName ?? "participant";
      toast(`Removed ${name}`, {
        action: snap ? { label: "Undo", onClick: () => adminRestore(snap) } : undefined,
      });
    } else if (kind === "admin-restored") {
      toast.success("Participant restored");
    }
  }, [adminFetcher.state, adminFetcher.data]);

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
          <saveFetcher.Form ref={joinFormRef} method="post" className="mt-4 flex flex-col gap-4">
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
            <div className="flex items-center justify-between gap-2">
              <Button type="submit" disabled={saveFetcher.state !== "idle"}>
                {currentParticipantId ? "Update" : "Join"}
              </Button>
              {currentParticipantId ? (
                <deleteFetcher.Form
                  method="post"
                  onSubmit={() => {
                    snapshotRef.current = {
                      displayName: currentParticipantName ?? "",
                      slotIds: [...ownSlotIds],
                    };
                  }}
                >
                  <input type="hidden" name="intent" value="delete-response" />
                  <Button
                    type="submit"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    disabled={deleteFetcher.state !== "idle"}
                  >
                    <Trash2 className="size-4" />
                    Remove my availability
                  </Button>
                </deleteFetcher.Form>
              ) : null}
            </div>
          </saveFetcher.Form>
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
                        <span className="inline-flex items-center gap-1">
                          <span>{p.displayName}</span>
                          {isOwner ? (
                            <button
                              type="button"
                              onClick={() =>
                                adminDelete(p, Array.from(availByParticipant.get(p.id) ?? []))
                              }
                              disabled={adminFetcher.state !== "idle"}
                              className="rounded p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
                              aria-label={`Remove ${p.displayName}`}
                            >
                              <X className="size-3" />
                            </button>
                          ) : null}
                        </span>
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
