import { redirect } from "react-router";
import { getOptionalUser, requireUser } from "../auth/auth-redirect.server";
import { deriveDayRanges } from "../scheduling/slots";
import { getEventBundle } from "./bundle.server";
import {
  createEventWithSlots,
  listEventsForUser,
  softDeleteEvent,
  updateEventForOwner,
} from "./repository.server";
import { parseEventForm } from "./validate";

export async function createEvent(env: Env, request: Request) {
  const form = await request.formData();
  const parsed = parseEventForm(form);
  if (!parsed.ok) {
    return new Response(parsed.errors.join("\n"), { status: 400 });
  }
  const user = await getOptionalUser(env, request);
  const { event } = await createEventWithSlots(env.DB, {
    title: parsed.value.title,
    description: parsed.value.description,
    slotMinutes: parsed.value.slotMinutes,
    ownerUserId: user?.id ?? null,
    slots: parsed.value.slots,
  });
  throw redirect(`/e/${event.id}`);
}

export async function loadOwnedEvent(env: Env, request: Request, eventId: string) {
  const user = await requireUser(env, request);
  const bundle = await getEventBundle(env.DB, eventId);
  if (!bundle) throw new Response("Not found", { status: 404 });
  if (bundle.event.ownerUserId !== user.id) {
    throw new Response("Forbidden", { status: 403 });
  }
  return {
    user: { name: user.name, email: user.email, image: user.image },
    event: bundle.event,
    initialDays: deriveDayRanges(bundle.slots, bundle.event.slotMinutes),
  };
}

export async function editEvent(env: Env, request: Request, eventId: string) {
  const user = await requireUser(env, request);
  const form = await request.formData();
  const parsed = parseEventForm(form);
  if (!parsed.ok) {
    return new Response(parsed.errors.join("\n"), { status: 400 });
  }
  const result = await updateEventForOwner(env.DB, eventId, user.id, {
    title: parsed.value.title,
    description: parsed.value.description,
    slotMinutes: parsed.value.slotMinutes,
    slots: parsed.value.slots,
  });
  if (!result) throw new Response("Not found", { status: 404 });
  throw redirect(`/e/${eventId}`);
}

export async function deleteEvent(env: Env, request: Request, eventId: string) {
  const user = await requireUser(env, request);
  const ok = await softDeleteEvent(env.DB, eventId, user.id);
  if (!ok) throw new Response("Not found", { status: 404 });
  throw redirect("/events");
}

export async function loadOwnedEvents(env: Env, request: Request) {
  const user = await requireUser(env, request);
  const events = await listEventsForUser(env.DB, user.id);
  return { user: { name: user.name, email: user.email, image: user.image }, events };
}
