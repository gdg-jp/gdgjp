import { beforeEach, expect, it, vi } from "vitest";
import { getOptionalUser } from "../auth/auth-redirect.server";
import { getEventBundle } from "../events/bundle.server";
import { loadEventParticipation, respondToEvent } from "./event.server";
import { hashToken, serializeCookie } from "./participant-cookie";
import { deleteParticipant, setAvailability } from "./repository.server";

vi.mock("../auth/auth-redirect.server", () => ({ getOptionalUser: vi.fn() }));
vi.mock("../events/bundle.server", () => ({ getEventBundle: vi.fn() }));
vi.mock("./repository.server", () => ({
  createParticipant: vi.fn(),
  deleteParticipant: vi.fn(),
  findParticipantByUser: vi.fn(),
  setAvailability: vi.fn(),
}));
const env = { DB: {} } as Env;
const eventId = "evt_test";
beforeEach(async () => {
  vi.resetAllMocks();
  vi.mocked(getOptionalUser).mockResolvedValue(null);
  vi.mocked(getEventBundle).mockResolvedValue({
    event: {
      id: eventId,
      title: "Sync",
      description: null,
      slotMinutes: 60,
      ownerUserId: "owner",
      createdAt: 1,
      updatedAt: 1,
      deletedAt: null,
    },
    slots: [{ id: 10, eventId, dayOfWeek: 0, startTime: "09:00" }],
    participants: [
      {
        id: 1,
        eventId,
        userId: null,
        displayName: "Anon",
        editTokenHash: await hashToken("secret"),
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    availabilities: [{ participantId: 1, slotId: 10 }],
  });
});
function request(intent?: string, token = "secret") {
  const form = new FormData();
  if (intent) form.set("intent", intent);
  form.append("slot_id", "10");
  form.append("slot_id", "999");
  form.set("participantId", "1");
  return new Request(`https://scheduler.test/e/${eventId}`, {
    headers: { Cookie: serializeCookie(eventId, 1, token, { secure: true }) },
    ...(intent ? { method: "POST", body: form } : {}),
  });
}
it("resolves a valid anonymous cookie and limits writes to this event's slots", async () => {
  const result = await loadEventParticipation(env, request(), eventId);
  expect(result.currentParticipantId).toBe(1);
  expect(result.ownSlotIds).toEqual([10]);
  await respondToEvent(env, request("update"), eventId);
  expect(setAvailability).toHaveBeenCalledWith(env.DB, 1, [10]);
});
it("rejects an invalid edit token before availability writes", async () => {
  await expect(respondToEvent(env, request("update", "wrong"), eventId)).rejects.toMatchObject({
    status: 403,
  });
  expect(setAvailability).not.toHaveBeenCalled();
});
it("does not claim an anonymous response when a signed-in user has no participant row", async () => {
  vi.mocked(getOptionalUser).mockResolvedValue({
    id: "other",
    name: "Other",
    email: "other@example.test",
  } as NonNullable<Awaited<ReturnType<typeof getOptionalUser>>>);
  const result = await loadEventParticipation(env, request(), eventId);
  expect(result.currentParticipantId).toBeNull();
  await expect(respondToEvent(env, request("update"), eventId)).rejects.toMatchObject({
    status: 403,
  });
  expect(setAvailability).not.toHaveBeenCalled();
});
it("rejects participant admin deletion without event ownership", async () => {
  await expect(
    respondToEvent(env, request("admin-delete-participant"), eventId),
  ).rejects.toMatchObject({ status: 403 });
  expect(deleteParticipant).not.toHaveBeenCalled();
});
