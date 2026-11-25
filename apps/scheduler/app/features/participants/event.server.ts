import { data } from "react-router";
import { getOptionalUser } from "../auth/auth-redirect.server";
import { getEventBundle } from "../events/bundle.server";
import type { Participant } from "./model";
import {
  hashToken,
  parseFromHeader,
  participantCookieHeaders,
  randomToken,
  verify,
} from "./participant-cookie";
import {
  createParticipant,
  findParticipantById,
  findParticipantByUser,
  restoreParticipant,
  setAvailability,
  softDeleteParticipant,
} from "./repository.server";
import { parseSlotIds } from "./validate";

type SessionUser = Awaited<ReturnType<typeof getOptionalUser>>;

type ParticipantLookup = {
  byUser(userId: string): Promise<Participant | null>;
  byId(participantId: number): Promise<Participant | null>;
};

type CurrentParticipant = { participant: Participant; guestToken: string | null };

function activeParticipants(participants: Participant[]): ParticipantLookup {
  return {
    byUser: async (userId) => participants.find((p) => p.userId === userId) ?? null,
    byId: async (participantId) => participants.find((p) => p.id === participantId) ?? null,
  };
}

function storedParticipants(db: D1Database, eventId: string): ParticipantLookup {
  return {
    byUser: (userId) => findParticipantByUser(db, eventId, userId),
    byId: (participantId) => findParticipantById(db, eventId, participantId),
  };
}

async function resolveCurrentParticipant(
  user: SessionUser,
  request: Request,
  eventId: string,
  lookup: ParticipantLookup,
): Promise<CurrentParticipant | null> {
  if (user) {
    const participant = await lookup.byUser(user.id);
    return participant ? { participant, guestToken: null } : null;
  }
  for (const credential of parseFromHeader(request.headers.get("Cookie"), eventId)) {
    const candidate = await lookup.byId(credential.participantId);
    if (!candidate?.editTokenHash) continue;
    const hashed = await hashToken(credential.token);
    if (verify(hashed, candidate.editTokenHash)) {
      return { participant: candidate, guestToken: credential.token };
    }
  }
  return null;
}

function isSecure(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

export async function loadEventParticipation(env: Env, request: Request, eventId: string) {
  const bundle = await getEventBundle(env.DB, eventId);
  if (!bundle) throw new Response("Not found", { status: 404 });
  const user = await getOptionalUser(env, request);
  const current = await resolveCurrentParticipant(
    user,
    request,
    bundle.event.id,
    activeParticipants(bundle.participants),
  );
  const own = current
    ? new Set(
        bundle.availabilities
          .filter((a) => a.participantId === current.participant.id)
          .map((a) => a.slotId),
      )
    : new Set<number>();
  return data(
    {
      user: user ? { name: user.name, email: user.email, image: user.image } : null,
      isOwner: !!user && user.id === bundle.event.ownerUserId,
      event: bundle.event,
      slots: bundle.slots,
      participants: bundle.participants,
      availabilities: bundle.availabilities,
      currentParticipantId: current?.participant.id ?? null,
      currentParticipantName: current?.participant.displayName ?? null,
      ownSlotIds: Array.from(own),
    },
    current?.guestToken
      ? {
          headers: participantCookieHeaders(
            bundle.event.id,
            current.participant.id,
            current.guestToken,
            { secure: isSecure(request) },
          ),
        }
      : undefined,
  );
}

function requireOwner(user: SessionUser, ownerUserId: string | null) {
  if (!user || user.id !== ownerUserId) throw new Response("Forbidden", { status: 403 });
}

function formParticipantId(form: FormData): number {
  return Number.parseInt((form.get("participantId") ?? "").toString(), 10);
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
    const current = await resolveCurrentParticipant(
      user,
      request,
      eventId,
      activeParticipants(bundle.participants),
    );
    if (!current) throw new Response("Not joined", { status: 403 });
    await setAvailability(env.DB, current.participant.id, requested);
    return data({ ok: true as const, kind: "updated" as const });
  }

  if (intent === "delete-response") {
    const current = await resolveCurrentParticipant(
      user,
      request,
      eventId,
      activeParticipants(bundle.participants),
    );
    if (!current) throw new Response("Not joined", { status: 403 });
    await softDeleteParticipant(env.DB, current.participant.id);
    return data({ ok: true as const, kind: "deleted" as const });
  }

  if (intent === "restore-response") {
    const own = await resolveCurrentParticipant(
      user,
      request,
      eventId,
      storedParticipants(env.DB, eventId),
    );
    if (!own) throw new Response("Not joined", { status: 403 });
    await restoreParticipant(env.DB, own.participant.id);
    return data({ ok: true as const, kind: "restored" as const });
  }

  if (intent === "admin-delete-participant") {
    requireOwner(user, bundle.event.ownerUserId);
    const participantId = formParticipantId(form);
    const target = bundle.participants.find((p) => p.id === participantId);
    if (!target) throw new Response("Participant not found", { status: 404 });
    await softDeleteParticipant(env.DB, target.id);
    return data({ ok: true as const, kind: "admin-deleted" as const });
  }

  if (intent === "admin-restore-participant") {
    requireOwner(user, bundle.event.ownerUserId);
    const target = await findParticipantById(env.DB, eventId, formParticipantId(form));
    if (!target) throw new Response("Participant not found", { status: 404 });
    await restoreParticipant(env.DB, target.id);
    return data({ ok: true as const, kind: "admin-restored" as const });
  }

  if (intent === "join") {
    if (user) {
      const existing = await findParticipantByUser(env.DB, eventId, user.id);
      if (existing?.deletedAt) await restoreParticipant(env.DB, existing.id);
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
    return data(
      { ok: true as const, kind: "joined" as const },
      {
        headers: participantCookieHeaders(eventId, participant.id, token, {
          secure: isSecure(request),
        }),
      },
    );
  }

  throw new Response("Unknown intent", { status: 400 });
}
