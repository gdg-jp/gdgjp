import { AsyncLocalStorage } from "node:async_hooks";

const BETTER_AUTH_GLOBAL = Symbol.for("better-auth:global");

type BetterAuthGlobalContext = {
  adapterAsyncStorage?: AsyncLocalStorage<unknown>;
  endpointContextAsyncStorage?: AsyncLocalStorage<unknown>;
  requestStateAsyncStorage?: AsyncLocalStorage<unknown>;
};

type BetterAuthGlobal = {
  version: string;
  epoch: number;
  context: BetterAuthGlobalContext;
};

/**
 * Pre-populate better-auth's AsyncLocalStorage slots at isolate startup.
 *
 * `@better-auth/core` otherwise resolves `AsyncLocalStorage` through a
 * module-scope dynamic `import("node:async_hooks")` promise. When that promise
 * is first evaluated inside an aborted request's I/O context, workerd never
 * settles it and every later `auth.api.*` / `auth.handler` call hangs forever.
 * Seeding here (Worker entry module graph, outside any request) means
 * `ensureAsyncStorage()` never awaits the poisonable promise.
 */
export function seedBetterAuthAsyncLocalStorage(
  globalObject: typeof globalThis = globalThis,
): void {
  const bag = globalObject as typeof globalThis & {
    [BETTER_AUTH_GLOBAL]?: BetterAuthGlobal;
  };
  const existing = bag[BETTER_AUTH_GLOBAL];
  const betterAuthGlobal: BetterAuthGlobal = existing ?? {
    version: "seeded",
    epoch: 1,
    context: {},
  };
  if (!existing) {
    bag[BETTER_AUTH_GLOBAL] = betterAuthGlobal;
  }

  const { context } = betterAuthGlobal;
  if (!context.adapterAsyncStorage) {
    context.adapterAsyncStorage = new AsyncLocalStorage();
  }
  if (!context.endpointContextAsyncStorage) {
    context.endpointContextAsyncStorage = new AsyncLocalStorage();
  }
  if (!context.requestStateAsyncStorage) {
    context.requestStateAsyncStorage = new AsyncLocalStorage();
  }
}
