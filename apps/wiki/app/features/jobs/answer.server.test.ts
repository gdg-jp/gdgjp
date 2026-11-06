import { describe, expect, it, vi } from "vitest";
import { type AgentReader, resolveAgentReader } from "~/features/agent-api/agent-reader.server";
import { createSpacesTestDb } from "~/features/spaces/test-db";
import { enqueueAnswer, expireAnswer, leaseAnswerBundle, validateBundle } from "./answer.server";

const SERVICE = "s".repeat(40);

function bucket() {
  const objects = new Map<string, string>();
  return {
    objects,
    put: vi.fn(async (key: string, value: string) => void objects.set(key, value)),
    get: vi.fn(async (key: string) =>
      objects.has(key) ? { text: async () => objects.get(key) as string } : null,
    ),
    delete: vi.fn(async (key: string) => void objects.delete(key)),
  };
}

function setup() {
  const ctx = createSpacesTestDb();
  ctx.sqlite.exec(`
    INSERT INTO spaces (id, slug, name, kind) VALUES ('team', 'team', 'Team', 'shared');
    INSERT INTO space_members (space_id, principal_type, principal_id, role) VALUES
      ('team', 'discord_guild', '123456789', 'viewer');
  `);
  const BUCKET = bucket();
  const env = {
    BUCKET,
    AGENT_SERVICE_TOKEN: SERVICE,
    ACCOUNTS_URL: "https://accounts.example",
  } as unknown as Env;
  return { ...ctx, env, BUCKET };
}

const guild: AgentReader = {
  identity: { user: null, chapters: [], claimsAvailable: false },
  extraPrincipals: [{ type: "discord_guild", id: "123456789" }],
  via: "principal",
};

const request = (token: string, headers: Record<string, string> = {}) =>
  new Request("https://wiki.example/api/agent/page", {
    headers: { authorization: `Bearer ${token}`, ...headers },
  });

describe("answer jobs", () => {
  it("narrows the requested spaces to what the reader can reach", async () => {
    const { db, env, sqlite } = setup();
    const { jobId } = await enqueueAnswer(env, db, guild, {
      question: "会場は？",
      spaces: ["team", "secret"],
      bundle: { "question.md": "会場は？" },
    });
    const row = sqlite
      .prepare("SELECT type, priority, space_id, payload FROM agent_jobs WHERE id = ?")
      .get(jobId) as {
      payload: string;
      space_id: string;
    };
    expect(row).toMatchObject({ type: "answer", priority: 10, space_id: "team" });
    expect(JSON.parse(row.payload).spaces).toEqual(["team"]);
  });

  it("issues an asker-scoped job token with the bundle, and expiry revokes it", async () => {
    const { db, env, sqlite } = setup();
    const { jobId } = await enqueueAnswer(env, db, guild, {
      question: "q",
      spaces: [],
      bundle: { "question.md": "q", "hits/01-team-venue.md": "body" },
    });
    expect(await leaseAnswerBundle(env, db, jobId)).toBeNull(); // not leased yet
    sqlite.prepare("UPDATE agent_jobs SET status = 'leased' WHERE id = ?").run(jobId);
    const first = await leaseAnswerBundle(env, db, jobId);
    const second = await leaseAnswerBundle(env, db, jobId);
    expect(second?.files["hits/01-team-venue.md"]).toBe("body");

    // Only the newest token reads, and only as the guild.
    expect(
      await resolveAgentReader(request(first?.jobToken ?? ""), env, db, { allowJobToken: true }),
    ).toBeNull();
    const reader = await resolveAgentReader(request(second?.jobToken ?? ""), env, db, {
      allowJobToken: true,
    });
    expect(reader).toMatchObject({
      via: "job",
      jobId,
      extraPrincipals: [{ type: "discord_guild", id: "123456789" }],
    });
    expect(reader?.identity.user).toBeNull();
    // Routes that do not opt in (everything but search / page) refuse job tokens.
    expect(await resolveAgentReader(request(second?.jobToken ?? ""), env, db)).toBeNull();

    expect(await expireAnswer(env, db, jobId)).toBe(true);
    expect(
      await resolveAgentReader(request(second?.jobToken ?? ""), env, db, { allowJobToken: true }),
    ).toBeNull();
    expect(env.BUCKET.delete).toHaveBeenCalled();
  });

  it("accepts the service token only with a well-formed principal", async () => {
    const { db, env } = setup();
    expect(
      await resolveAgentReader(
        request(SERVICE, { "x-agent-principal": "discord_guild:123456789" }),
        env,
        db,
      ),
    ).toMatchObject({
      via: "principal",
    });
    expect(await resolveAgentReader(request(SERVICE), env, db)).toMatchObject({
      via: "anonymous",
      extraPrincipals: [],
    });
    expect(
      await resolveAgentReader(request(SERVICE, { "x-agent-principal": "user:admin" }), env, db),
    ).toBeNull();
    expect(
      await resolveAgentReader(
        request(SERVICE, { "x-agent-principal": "discord_guild:../x" }),
        env,
        db,
      ),
    ).toBeNull();
  });

  it("confines eval readers to e2e spaces and queues their answers last", async () => {
    const { db, env, sqlite } = setup();
    sqlite.exec(`
      INSERT INTO spaces (id, slug, name, kind) VALUES ('e2e-eval', 'e2e-eval', 'Eval', 'shared');
      INSERT INTO space_members (space_id, principal_type, principal_id, role) VALUES
        ('e2e-eval', 'chapter_role', 'e2e-chapter:member', 'viewer');
    `);
    const reader = await resolveAgentReader(
      request(SERVICE, { "x-agent-eval-as": "organizer:e2e-chapter" }),
      env,
      db,
    );
    expect(reader).toMatchObject({ via: "eval", identity: { chapters: [{ role: "organizer" }] } });
    if (!reader) throw new Error("no reader");
    // gdg-jp is public, but an eval reader never reaches it.
    const { jobId } = await enqueueAnswer(env, db, reader, {
      question: "q",
      spaces: [],
      bundle: { "question.md": "q" },
    });
    const row = sqlite
      .prepare("SELECT priority, payload FROM agent_jobs WHERE id = ?")
      .get(jobId) as {
      priority: number;
      payload: string;
    };
    expect(row.priority).toBe(-20);
    expect(JSON.parse(row.payload).spaces).toEqual(["e2e-eval"]);
    // Its job token is confined the same way.
    sqlite.prepare("UPDATE agent_jobs SET status = 'leased' WHERE id = ?").run(jobId);
    const bundle = await leaseAnswerBundle(env, db, jobId);
    const viaToken = await resolveAgentReader(request(bundle?.jobToken ?? ""), env, db, {
      allowJobToken: true,
    });
    expect(viaToken?.via).toBe("eval");
    expect(
      await resolveAgentReader(request(SERVICE, { "x-agent-eval-as": "admin" }), env, db),
    ).toBeNull();
    // Without the service token the header means nothing.
    expect(
      await resolveAgentReader(request("jt_nope", { "x-agent-eval-as": "guest" }), env, db),
    ).toBeNull();
  });

  it("validates bundle paths and size", () => {
    expect(validateBundle({ "question.md": "q", "hits/01-a.md": "x" })).not.toBeNull();
    expect(validateBundle({ "question.md": "q", "../etc/passwd": "x" })).toBeNull();
    expect(validateBundle({ "hits/01-a.md": "x" })).toBeNull();
    expect(validateBundle({ "question.md": "x".repeat(3 * 1024 * 1024) })).toBeNull();
  });
});
