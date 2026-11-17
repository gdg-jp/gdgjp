import { afterEach, expect, it, vi } from "vitest";
import { createSpacesTestDb } from "~/features/spaces/test-db";

let fixture: ReturnType<typeof createSpacesTestDb>;
vi.mock("~/lib/db.server", () => ({ getDb: () => fixture.db }));

import { action } from "./jobs-heartbeat";

afterEach(() => fixture?.sqlite.close());

it("requires a nonnegative captured generation before extending the same host's lease", async () => {
  fixture = createSpacesTestDb();
  fixture.sqlite.exec(`INSERT INTO agent_jobs (id,type,space_id,status,lease_owner,lease_until,attempts)
    VALUES ('job','translate','gdg-jp','leased','vm',1,2)`);
  const token = "test-runner-token-0123456789abcdef0123456789";
  for (const [body, status] of [
    [{}, 400],
    [{ attempts: -1 }, 400],
    [{ attempts: "2" }, 400],
    [{ attempts: 0 }, 409],
    [{ attempts: 2 }, 200],
  ] as const) {
    const response = await action({
      request: new Request("http://wiki.test/api/runner/jobs/job/heartbeat", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "x-runner-host": "vm",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
      params: { id: "job" },
      unstable_url: new URL("http://wiki.test/api/runner/jobs/job/heartbeat"),
      unstable_pattern: "/api/runner/jobs/:id/heartbeat",
      context: { cloudflare: { env: { RUNNER_TOKEN: token } } },
    });
    expect(response.status).toBe(status);
  }
  expect(
    fixture.sqlite.prepare("SELECT status,attempts,lease_owner FROM agent_jobs").get(),
  ).toEqual({ status: "leased", attempts: 2, lease_owner: "vm" });
});
