import { data } from "react-router";
import { getOptionalUser } from "../auth/auth-redirect.server";
import { getEventBundle } from "../events/bundle.server";
import type { Participant } from "./model";
import {
  clearCookie,
  hashToken,
  parseFromHeader,
  randomToken,
  serializeCookie,
  verify,
} from "./participant-cookie";
import {
  createParticipant,
  deleteParticipant,
  findParticipantByUser,
  setAvailability,
} from "./repository.server";
import { parseSlotIds } from "./validate";
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

export async function loadEventParticipation(env: Env, request: Request, eventId: string) {
  const bundle = await getEventBundle(env.DB, eventId);
  if (!bundle) throw new Response("Not found", { status: 404 });
  const user = await getOptionalUser(env, request);
  const current = await resolveCurrentParticipant(
    env,
    request,
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

export async function respondToEvent(env: Env, request: Request, eventId: string) {
  const bundle = await getEventBundle(env.DB, eventId);
  if (!bundle) throw new Response("Not found", { status: 404 });

  const form = await request.formData();
  const intent = form.get("intent");
  const validSlotIds = new Set(bundle.slots.map((s) => s.id));
  const requested = parseSlotIds(form).filter((id) => validSlotIds.has(id));

  const user = await getOptionalUser(env, request);

  if (intent === "update") {
    const current = await resolveCurrentParticipant(env, request, eventId, bundle.participants);
    if (!current) throw new Response("Not joined", { status: 403 });
    await setAvailability(env.DB, current.id, requested);
    return data({ ok: true as const, kind: "updated" as const });
  }

  if (intent === "delete-response") {
    const current = await resolveCurrentParticipant(env, request, eventId, bundle.participants);
    if (!current) throw new Response("Not joined", { status: 403 });
    await deleteParticipant(env.DB, current.id);
    const headers: HeadersInit = {};
    if (!current.userId) {
      const secure = new URL(request.url).protocol === "https:";
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
    const secure = new URL(request.url).protocol === "https:";
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
