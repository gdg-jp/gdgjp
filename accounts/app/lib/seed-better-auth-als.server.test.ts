import { AsyncLocalStorage } from "node:async_hooks";
import { describe, expect, it } from "vitest";
import { seedBetterAuthAsyncLocalStorage } from "./seed-better-auth-als.server";

const BETTER_AUTH_GLOBAL = Symbol.for("better-auth:global");

type SeededContext = {
  adapterAsyncStorage?: AsyncLocalStorage<unknown>;
  endpointContextAsyncStorage?: AsyncLocalStorage<unknown>;
  requestStateAsyncStorage?: AsyncLocalStorage<unknown>;
};

function readContext(globalObject: typeof globalThis): SeededContext {
  const bag = globalObject as typeof globalThis & {
    [BETTER_AUTH_GLOBAL]?: { context: SeededContext };
  };
  const context = bag[BETTER_AUTH_GLOBAL]?.context;
  if (!context) throw new Error("better-auth global was not seeded");
  return context;
}

describe("seedBetterAuthAsyncLocalStorage", () => {
  it("installs all three AsyncLocalStorage slots on the better-auth global", () => {
    const isolated = Object.create(null) as typeof globalThis;
    seedBetterAuthAsyncLocalStorage(isolated);

    const context = readContext(isolated);
    expect(context.adapterAsyncStorage).toBeInstanceOf(AsyncLocalStorage);
    expect(context.endpointContextAsyncStorage).toBeInstanceOf(AsyncLocalStorage);
    expect(context.requestStateAsyncStorage).toBeInstanceOf(AsyncLocalStorage);
  });

  it("does not replace storages that are already present", () => {
    const isolated = Object.create(null) as typeof globalThis;
    const existing = new AsyncLocalStorage();
    const bag = isolated as typeof globalThis & {
      [BETTER_AUTH_GLOBAL]: {
        version: string;
        epoch: number;
        context: SeededContext;
      };
    };
    bag[BETTER_AUTH_GLOBAL] = {
      version: "1.6.23",
      epoch: 1,
      context: { requestStateAsyncStorage: existing },
    };

    seedBetterAuthAsyncLocalStorage(isolated);

    const context = readContext(isolated);
    expect(context.requestStateAsyncStorage).toBe(existing);
    expect(context.adapterAsyncStorage).toBeInstanceOf(AsyncLocalStorage);
    expect(context.endpointContextAsyncStorage).toBeInstanceOf(AsyncLocalStorage);
  });
});
