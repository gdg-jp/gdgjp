import { createRequestHandler } from "react-router";
import { seedClients } from "../app/lib/seed-clients.server";

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
    if (env.E2E_TEST_MODE === "true") await seedE2eClients(env);
    return requestHandler(request, { cloudflare: { env, ctx } });
  },
} satisfies ExportedHandler<Env>;
