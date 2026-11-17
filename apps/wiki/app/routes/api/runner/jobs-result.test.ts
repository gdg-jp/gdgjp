import { afterEach, expect, it, vi } from "vitest";
import { createSpacesTestDb } from "~/features/spaces/test-db";

let fixture: ReturnType<typeof createSpacesTestDb>;
vi.mock("~/lib/db.server", () => ({ getDb: () => fixture.db }));
vi.mock("~/features/notifications/notify.server", () => ({ createNotification: vi.fn() }));

import { action } from "./jobs-result";

afterEach(() => fixture?.sqlite.close());

it("rejects missing and stale generations, then accepts the active result exactly once", async () => {
  fixture = createSpacesTestDb();
  fixture.sqlite.exec(`INSERT INTO agent_jobs (id,type,space_id,status,lease_owner,lease_until,attempts)
    VALUES ('job','translate','gdg-jp','leased','vm',1,2)`);
  const token = "test-runner-token-0123456789abcdef0123456789";
  for (const [body, status] of [
    [{ status: "succeeded" }, 400],
    [{ status: "succeeded", attempts: null }, 400],
    [{ status: "succeeded", attempts: 0 }, 409],
    [{ status: "succeeded", attempts: 2 }, 200],
    [{ status: "succeeded", attempts: 2 }, 409],
  ] as const) {
    const response = await action({
      request: new Request("http://wiki.test/api/runner/jobs/job/result", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "x-runner-host": "vm",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
      params: { id: "job" },
      unstable_url: new URL("http://wiki.test/api/runner/jobs/job/result"),
      unstable_pattern: "/api/runner/jobs/:id/result",
      context: { cloudflare: { env: { RUNNER_TOKEN: token } } },
    });
    expect(response.status).toBe(status);
  }
  expect(fixture.sqlite.prepare("SELECT status,attempts FROM agent_jobs").get()).toEqual({
    status: "succeeded",
    attempts: 2,
  });
});
