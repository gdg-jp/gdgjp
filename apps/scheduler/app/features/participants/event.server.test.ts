import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getOptionalUser } from "../auth/auth-redirect.server";
import { listEventsForUser } from "../events/repository.server";
import { loadEventParticipation, respondToEvent } from "./event.server";
import { hashToken } from "./participant-cookie";

vi.mock("../auth/auth-redirect.server", () => ({ getOptionalUser: vi.fn() }));

const migrationsDir = new URL("../../../migrations/", import.meta.url);

class SqliteStatement {
  constructor(
    private readonly raw: StatementSync,
    private readonly params: SQLInputValue[] = [],
  ) {}
  bind(...params: SQLInputValue[]) {
    return new SqliteStatement(this.raw, params);
  }
  async first<T>() {
    return (this.raw.get(...this.params) as T | undefined) ?? null;
  }
  async all<T>() {
    return { results: this.raw.all(...this.params) as T[] };
  }
  async run() {
    return this.execute();
  }
  execute() {
    return { success: true, results: this.raw.all(...this.params) };
  }
}

function migratedDatabase() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON;");
  for (const file of readdirSync(migrationsDir).sort()) {
    raw.exec(readFileSync(new URL(file, migrationsDir), "utf8"));
  }
  const db = {
    prepare: (sql: string) => new SqliteStatement(raw.prepare(sql)),
    async batch(statements: SqliteStatement[]) {
      raw.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.execute());
        raw.exec("COMMIT");
        return results;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { raw, db: db as unknown as D1Database };
}

type SessionUser = NonNullable<Awaited<ReturnType<typeof getOptionalUser>>>;

const eventId = "evt_test";
const otherEventId = "evt_other";
const owner = { id: "owner", name: "Owner", email: "owner@example.test" } as SessionUser;
const member = { id: "member", name: "Member", email: "member@example.test" } as SessionUser;

let raw: DatabaseSync;
let env: Env;

beforeEach(async () => {
  vi.resetAllMocks();
  vi.mocked(getOptionalUser).mockResolvedValue(null);
  const created = migratedDatabase();
  raw = created.raw;
  env = { DB: created.db } as Env;
  raw.exec(`
    INSERT INTO events (id, title, owner_user_id) VALUES ('${eventId}', 'Sync', 'owner');
    INSERT INTO events (id, title, owner_user_id) VALUES ('${otherEventId}', 'Other', 'owner');
    INSERT INTO event_slots (id, event_id, day_of_week, start_time) VALUES
      (10, '${eventId}', 0, '09:00'),
      (11, '${eventId}', 0, '10:00'),
      (20, '${otherEventId}', 0, '09:00');
  `);
  raw
    .prepare(
      "INSERT INTO event_participants (id, event_id, display_name, edit_token_hash) VALUES (1, ?, 'Anon', ?)",
    )
    .run(eventId, await hashToken("secret"));
  raw.exec("INSERT INTO event_availabilities (participant_id, slot_id) VALUES (1, 10)");
});

function signIn(user: SessionUser | null) {
  vi.mocked(getOptionalUser).mockResolvedValue(user);
}

function guestCookie(participantId: number, token: string, event = eventId) {
  return `scheduler_p_${event}=${participantId}.${token}`;
}

function page(cookie?: string) {
  return new Request(`https://scheduler.test/e/${eventId}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

function post(fields: Record<string, string | string[]>, cookie?: string) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) form.append(key, item);
  }
  return new Request(`https://scheduler.test/e/${eventId}.data`, {
    method: "POST",
    body: form,
    headers: cookie ? { Cookie: cookie } : {},
  });
}

async function view(cookie?: string) {
  return (await loadEventParticipation(env, page(cookie), eventId)).data;
}

function participantRows() {
  return raw
    .prepare(
      "SELECT id, user_id, display_name, edit_token_hash, deleted_at FROM event_participants WHERE event_id = ? ORDER BY id",
    )
    .all(eventId);
}

function availability(participantId: number) {
  return raw
    .prepare("SELECT slot_id FROM event_availabilities WHERE participant_id = ? ORDER BY slot_id")
    .all(participantId)
    .map((row) => row.slot_id);
}

describe("guest identity", () => {
  it("resolves a valid guest cookie and limits writes to this event's slots", async () => {
    const result = await view(guestCookie(1, "secret"));
    expect(result.currentParticipantId).toBe(1);
    expect(result.ownSlotIds).toEqual([10]);
    await respondToEvent(
      env,
      post({ intent: "update", slot_id: ["11", "20", "999"] }, guestCookie(1, "secret")),
      eventId,
    );
    expect(availability(1)).toEqual([11]);
  });

  it("rejects an invalid edit token before availability writes", async () => {
    await expect(
      respondToEvent(
        env,
        post({ intent: "update", slot_id: "11" }, guestCookie(1, "wrong")),
        eventId,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(availability(1)).toEqual([10]);
  });

  it("does not claim a guest response when a signed-in user has no participant row", async () => {
    signIn(member);
    expect((await view(guestCookie(1, "secret"))).currentParticipantId).toBeNull();
    await expect(
      respondToEvent(
        env,
        post({ intent: "update", slot_id: "11" }, guestCookie(1, "secret")),
        eventId,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(availability(1)).toEqual([10]);
  });

  it("moves a guest cookie from the event page path to one that also covers data requests", async () => {
    const response = await loadEventParticipation(env, page(guestCookie(1, "secret")), eventId);
    const cookies = new Headers(response.init?.headers).getSetCookie();
    expect(cookies).toEqual([
      expect.stringMatching(/^scheduler_p_evt_test=1\.secret; .*Path=\/e;/),
      expect.stringMatching(/^scheduler_p_evt_test=; .*Path=\/e\/evt_test; Max-Age=0/),
    ]);
    const anonymous = await loadEventParticipation(env, page(), eventId);
    expect(anonymous.init?.headers).toBeUndefined();
  });

  it("picks the cookie value that verifies when the browser sends two for the event", async () => {
    const result = await view(`${guestCookie(1, "stale")}; ${guestCookie(1, "secret")}`);
    expect(result.currentParticipantName).toBe("Anon");
  });
});

describe("removing and restoring participants", () => {
  it("restores a guest the owner removed with the same id, token and availability", async () => {
    signIn(owner);
    await respondToEvent(
      env,
      post({ intent: "admin-delete-participant", participantId: "1" }),
      eventId,
    );
    expect((await view()).participants).toEqual([]);
    signIn(null);
    expect((await view(guestCookie(1, "secret"))).currentParticipantId).toBeNull();

    signIn(owner);
    await respondToEvent(
      env,
      post({ intent: "admin-restore-participant", participantId: "1" }),
      eventId,
    );

    expect(participantRows()).toEqual([
      expect.objectContaining({ id: 1, display_name: "Anon", deleted_at: null }),
    ]);
    expect(availability(1)).toEqual([10]);
    signIn(null);
    const guest = await view(guestCookie(1, "secret"));
    expect(guest.currentParticipantId).toBe(1);
    expect(guest.ownSlotIds).toEqual([10]);
  });

  it("lets a guest undo removing their own response without losing their identity", async () => {
    const removed = await respondToEvent(
      env,
      post({ intent: "delete-response" }, guestCookie(1, "secret")),
      eventId,
    );
    expect(removed.data.kind).toBe("deleted");
    const afterRemoval = await view(guestCookie(1, "secret"));
    expect(afterRemoval.currentParticipantId).toBeNull();
    expect(afterRemoval.participants).toEqual([]);

    const restored = await respondToEvent(
      env,
      post({ intent: "restore-response" }, guestCookie(1, "secret")),
      eventId,
    );
    expect(restored.data.kind).toBe("restored");
    expect(participantRows()).toEqual([expect.objectContaining({ id: 1, deleted_at: null })]);
    const guest = await view(guestCookie(1, "secret"));
    expect(guest.currentParticipantId).toBe(1);
    expect(guest.ownSlotIds).toEqual([10]);
  });

  it("does not restore a removed guest for a wrong token", async () => {
    await respondToEvent(
      env,
      post({ intent: "delete-response" }, guestCookie(1, "secret")),
      eventId,
    );
    await expect(
      respondToEvent(env, post({ intent: "restore-response" }, guestCookie(1, "wrong")), eventId),
    ).rejects.toMatchObject({ status: 403 });
    expect(participantRows()).toEqual([
      expect.objectContaining({ id: 1, deleted_at: expect.any(Number) }),
    ]);
  });

  it("brings back the same row when a removed signed-in participant joins again", async () => {
    signIn(member);
    await respondToEvent(env, post({ intent: "join", slot_id: "10" }), eventId);
    const [joined] = participantRows().filter((row) => row.user_id === "member");
    await respondToEvent(env, post({ intent: "delete-response" }), eventId);
    expect((await view()).currentParticipantId).toBeNull();

    await respondToEvent(env, post({ intent: "join", slot_id: "11" }), eventId);

    const rows = participantRows().filter((row) => row.user_id === "member");
    expect(rows).toEqual([expect.objectContaining({ id: joined.id, deleted_at: null })]);
    expect(availability(Number(joined.id))).toEqual([11]);
    expect((await view()).currentParticipantId).toBe(joined.id);
  });

  it("leaves removed participants out of the owner's participant count", async () => {
    await respondToEvent(
      env,
      post({ intent: "delete-response" }, guestCookie(1, "secret")),
      eventId,
    );
    const events = await listEventsForUser(env.DB, "owner");
    expect(events.find((entry) => entry.event.id === eventId)?.participantCount).toBe(0);
  });

  it("rejects participant removal and restore without event ownership", async () => {
    signIn(member);
    for (const intent of ["admin-delete-participant", "admin-restore-participant"]) {
      await expect(
        respondToEvent(env, post({ intent, participantId: "1" }), eventId),
      ).rejects.toMatchObject({ status: 403 });
    }
    expect(participantRows()).toEqual([expect.objectContaining({ id: 1, deleted_at: null })]);
  });

  it("does not restore a participant of another event", async () => {
    raw
      .prepare(
        "INSERT INTO event_participants (id, event_id, display_name, deleted_at) VALUES (5, ?, 'Elsewhere', unixepoch())",
      )
      .run(otherEventId);
    signIn(owner);
    await expect(
      respondToEvent(
        env,
        post({ intent: "admin-restore-participant", participantId: "5" }),
        eventId,
      ),
    ).rejects.toMatchObject({ status: 404 });
  });
});
