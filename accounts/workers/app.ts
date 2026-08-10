import { AsyncLocalStorage } from "node:async_hooks";
import { createRequestHandler } from "react-router";
import { warmAuth } from "../app/lib/auth.server";
import { seedBetterAuthAsyncLocalStorage } from "../app/lib/seed-better-auth-als.server";
import { seedClients } from "../app/lib/seed-clients.server";

// Keep a static node:async_hooks import in the Worker entry so the isolate
// loads AsyncLocalStorage outside any request I/O context.
void AsyncLocalStorage;

seedBetterAuthAsyncLocalStorage();

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env?.MODE ?? "production",
);

let e2eSeedPromise: Promise<void> | undefined;

function seedE2eClients(env: Env): Promise<void> {
  if (!e2eSeedPromise) {
    e2eSeedPromise = seedClients(env)
      .then(() => undefined)
      .catch((error) => {
        e2eSeedPromise = undefined;
        throw error;
      });
  }
  return e2eSeedPromise;
}

export default {
  async fetch(request, env, ctx) {
    // Anchor betterAuth `$context` init to waitUntil so client abort cannot
    // poison the module-scoped init promise for the rest of this isolate.
    ctx.waitUntil(warmAuth(env));
    if (env.E2E_TEST_MODE === "true") await seedE2eClients(env);
    return requestHandler(request, { cloudflare: { env, ctx } });
  },
} satisfies ExportedHandler<Env>;
