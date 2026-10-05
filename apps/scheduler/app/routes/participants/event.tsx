import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  Card,
  FormField,
  IconButton,
  Icons,
  Input,
  PageHeader,
  Table,
  toast,
} from "@gdgjp/design-system";
import { useEffect, useRef } from "react";
import { Form, Link, useFetcher } from "react-router";
import { ShareUrl } from "~/components/share-url";
import { loadEventParticipation, respondToEvent } from "~/features/participants/event.server";
import type { Participant } from "~/features/participants/model";
import { SlotPillGrid } from "~/features/scheduling/components/slot-pill-grid";
import { DAY_LABELS } from "~/features/scheduling/slots";
import { Header } from "~/layouts/header";
import type { Route } from "./+types/event";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.event ? `${data.event.title} — Scheduler` : "Scheduler" }];
}
export function loader({ context, request, params }: Route.LoaderArgs) {
  return loadEventParticipation(context.cloudflare.env, request, params.id);
}
export function action({ context, request, params }: Route.ActionArgs) {
  return respondToEvent(context.cloudflare.env, request, params.id);
}
function formatLength(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

export default function EventPage({ loaderData }: Route.ComponentProps) {
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
          <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
            <div className="min-w-0 w-full flex-1 break-words">
              <PageHeader title={event.title} className="break-words" />
              {event.description ? (
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{event.description}</p>
              ) : null}
              <p className="mt-2 text-xs text-muted">
                Each meeting is {formatLength(event.slotMinutes)}.
              </p>
            </div>
            {isOwner ? (
              <div className="flex shrink-0 items-center gap-1">
                <Button variant="ghost" size="sm" asChild>
                  <Link to={`/e/${event.id}/edit`}>
                    <Icons name="Pencil" size={16} className="size-4" />
                    Edit
                  </Link>
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="sm">
                      <Icons name="Trash2" size={16} />
                      Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogTitle>Delete this event?</AlertDialogTitle>
                    <AlertDialogDescription>
                      The event and all participant availability will be removed.
                    </AlertDialogDescription>
                    <div className="flex flex-wrap justify-end gap-2">
                      <AlertDialogCancel asChild>
                        <Button variant="outline">Cancel</Button>
                      </AlertDialogCancel>
                      <Form method="post" action={`/e/${event.id}/delete`}>
                        <AlertDialogAction asChild>
                          <Button type="submit" variant="danger">
                            Delete event
                          </Button>
                        </AlertDialogAction>
                      </Form>
                    </div>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ) : null}
          </div>
          <ShareUrl path={`/e/${event.id}`} />
        </div>

        <Card className="mb-8">
          <h2 className="text-lg font-semibold">
            {currentParticipantId ? "Update your availability" : "Pick the times that work"}
          </h2>
          {currentParticipantName ? (
            <p className="mt-1 text-sm text-muted">
              Participating as <span className="font-medium">{currentParticipantName}</span>
            </p>
          ) : null}
          <saveFetcher.Form ref={joinFormRef} method="post" className="mt-4 flex flex-col gap-4">
            <input type="hidden" name="intent" value={currentParticipantId ? "update" : "join"} />
            {!currentParticipantId && !user ? (
              <FormField id="displayName" label="Your name" required>
                <Input
                  id="displayName"
                  name="displayName"
                  required
                  maxLength={100}
                  placeholder="Alice"
                />
              </FormField>
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button type="submit" loading={saveFetcher.state !== "idle"}>
                {currentParticipantId ? "Update" : "Join"}
              </Button>
            </div>
          </saveFetcher.Form>
          <div className="mt-4">
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
                <Button type="submit" variant="danger" loading={deleteFetcher.state !== "idle"}>
                  <Icons name="Trash2" size={16} className="size-4" />
                  Remove my availability
                </Button>
              </deleteFetcher.Form>
            ) : null}
          </div>
        </Card>

        {participants.length > 0 ? (
          <section>
            <h2 className="mb-2 text-sm font-medium text-muted">Who's available</h2>
            <div className="rounded-md border">
              <Table>
                <thead>
                  <tr>
                    <th scope="col">Slot</th>
                    {participants.map((p) => (
                      <th scope="col" key={p.id} className="text-center">
                        <div className="inline-flex items-center gap-1">
                          <span>{p.displayName}</span>
                          {isOwner ? (
                            <IconButton
                              variant="ghost"
                              onClick={() =>
                                adminDelete(p, Array.from(availByParticipant.get(p.id) ?? []))
                              }
                              disabled={adminFetcher.state !== "idle"}
                              aria-label={`Remove ${p.displayName}`}
                            >
                              <Icons name="X" size={16} className="size-3" />
                            </IconButton>
                          ) : null}
                        </div>
                      </th>
                    ))}
                    <th scope="col" className="text-center">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {slots.map((s) => (
                    <tr key={s.id}>
                      <td className="font-medium">
                        {DAY_LABELS[s.dayOfWeek]} {s.startTime}
                      </td>
                      {participants.map((p) => {
                        const has = availByParticipant.get(p.id)?.has(s.id) ?? false;
                        return (
                          <td key={p.id} className="text-center">
                            {has ? (
                              <Icons
                                name="Check"
                                size={16}
                                className="mx-auto text-success"
                                aria-label="Available"
                              />
                            ) : (
                              <span className="sr-only">Unavailable</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="text-center text-muted">{totals.get(s.id) ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
