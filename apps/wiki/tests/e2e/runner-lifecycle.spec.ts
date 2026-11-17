import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { z } from "zod";

const jobRow = z.object({
  status: z.string(),
  attempts: z.number().int(),
  lease_owner: z.string().nullable(),
  lease_until: z.number().nullable(),
  result: z.string().nullable(),
});
const queryResult = z.array(z.object({ results: z.array(jobRow) })).length(1);

function execute(sql: string): string {
  return execFileSync(
    "pnpm",
    [
      "exec",
      "wrangler",
      "d1",
      "execute",
      "gdgjp-wiki-db",
      "--local",
      "--persist-to",
      process.env.WIKI_E2E_PERSIST_TO ?? ".wrangler/e2e-state",
      "--command",
      sql,
      "--json",
    ],
    { cwd: fileURLToPath(new URL("../..", import.meta.url)), encoding: "utf8" },
  );
}

function readJob(id: string) {
  const statements = queryResult.parse(
    JSON.parse(
      execute(
        `SELECT status, attempts, lease_owner, lease_until, result FROM agent_jobs WHERE id = '${id}';`,
      ),
    ),
  );
  const rows = statements.flatMap((statement) => statement.results);
  expect(rows).toHaveLength(1);
  return rows[0];
}

test("same-host re-leasing rejects stale runner callbacks over HTTP", async ({ request }) => {
  const token = z.string().min(32).parse(process.env.WIKI_E2E_RUNNER_TOKEN);
  const id = randomUUID();
  const host = `e2e-generation-${id}`;
  const headers = { authorization: `Bearer ${token}`, "x-runner-host": host };
  const now = Math.floor(Date.now() / 1000);
  execute(
    `INSERT INTO agent_jobs (id, type, space_id, status, priority, payload, lease_owner, lease_until, attempts, run_after, created_at) VALUES ('${id}', 'translate', 'gdg-jp', 'leased', 1000000, '{}', '${host}', ${now - 60}, 0, ${now - 120}, ${now - 120});`,
  );
  try {
    const unauthorized = await request.get("/api/runner/jobs/next?types=translate&wait=0");
    expect(unauthorized.status()).toBe(401);
    expect(await unauthorized.json()).toEqual({ error: "invalid_token" });
    const unauthorizedResult = await request.post(`/api/runner/jobs/${id}/result`, {
      data: {},
    });
    expect(unauthorizedResult.status()).toBe(401);

    const leased = await request.get("/api/runner/jobs/next?types=translate&wait=0", {
      headers,
    });
    expect(leased.status()).toBe(200);
    expect(await leased.json()).toMatchObject({ id, type: "translate", attempts: 1 });
    expect(readJob(id)).toMatchObject({ status: "leased", attempts: 1, lease_owner: host });

    const heartbeatUrl = `/api/runner/jobs/${id}/heartbeat`;
    const resultUrl = `/api/runner/jobs/${id}/result`;
    const missingHeartbeat = await request.post(heartbeatUrl, { headers, data: {} });
    expect(missingHeartbeat.status()).toBe(400);
    expect(await missingHeartbeat.json()).toEqual({ error: "invalid_lease" });
    const missingResult = await request.post(resultUrl, {
      headers,
      data: { status: "succeeded" },
    });
    expect(missingResult.status()).toBe(400);
    expect(await missingResult.json()).toEqual({ error: "invalid_result" });

    const staleHeartbeat = await request.post(heartbeatUrl, { headers, data: { attempts: 0 } });
    expect(staleHeartbeat.status()).toBe(409);
    expect(await staleHeartbeat.json()).toEqual({ error: "lease_lost" });
    const staleResult = await request.post(resultUrl, {
      headers,
      data: { attempts: 0, status: "succeeded", result: { stale: true } },
    });
    expect(staleResult.status()).toBe(409);
    expect(await staleResult.json()).toEqual({ error: "lease_lost" });
    expect(readJob(id)).toMatchObject({
      status: "leased",
      attempts: 1,
      lease_owner: host,
      result: null,
    });

    const heartbeat = await request.post(heartbeatUrl, { headers, data: { attempts: 1 } });
    expect(heartbeat.status()).toBe(200);
    expect(await heartbeat.json()).toEqual({ ok: true });
    const result = await request.post(resultUrl, {
      headers,
      data: { attempts: 1, status: "succeeded", result: { accepted: id } },
    });
    expect(result.status()).toBe(200);
    expect(await result.json()).toEqual({ ok: true });

    const duplicate = await request.post(resultUrl, {
      headers,
      data: { attempts: 1, status: "succeeded", result: { duplicate: true } },
    });
    expect(duplicate.status()).toBe(409);
    expect(await duplicate.json()).toEqual({ error: "lease_lost" });
    expect(readJob(id)).toEqual({
      status: "succeeded",
      attempts: 1,
      lease_owner: host,
      lease_until: null,
      result: JSON.stringify({ accepted: id }),
    });
  } finally {
    execute(`DELETE FROM agent_jobs WHERE id = '${id}';`);
  }
});
