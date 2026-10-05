import { describe, expect, it, vi } from "vitest";
import type { XOAuthDependencies, XTokenExchange } from "./x-account.types";
import { XOAuthError, beginXConnect, completeXConnect } from "./x-oauth.service.server";

type TxRow = {
  state: string;
  provider: string;
  user_id: string;
  chapter_id: number;
  code_verifier: string;
  return_to: string;
  expires_at: string;
  created_at: string;
};

function makeDb(seed: { transactions?: TxRow[] } = {}) {
  const transactions: TxRow[] = (seed.transactions ?? []).map((row) => ({ ...row }));
  const xAccounts: Record<string, unknown>[] = [];

  function run(sql: string, b: unknown[]) {
    if (sql.startsWith("INSERT INTO oauth_transactions")) {
      const [state, userId, chapterId, verifier, returnTo, expiresAt, createdAt] = b as [
        string,
        string,
        number,
        string,
        string,
        string,
        string,
      ];
      transactions.push({
        state,
        provider: "x",
        user_id: userId,
        chapter_id: chapterId,
        code_verifier: verifier,
        return_to: returnTo,
        expires_at: expiresAt,
        created_at: createdAt,
      });
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("DELETE FROM oauth_transactions")) {
      const [state] = b as [string];
      for (let i = transactions.length - 1; i >= 0; i--) {
        if (transactions[i].state === state) transactions.splice(i, 1);
      }
      return { meta: { changes: 1 } };
    }
    if (sql.startsWith("INSERT INTO x_accounts")) {
      const [id, chapterId, xUserId, username, displayName] = b as string[];
      xAccounts.push({
        id,
        chapter_id: chapterId,
        x_user_id: xUserId,
        username,
        display_name: displayName,
      });
      return { meta: { changes: 1 } };
    }
    throw new Error(`Unhandled run SQL: ${sql}`);
  }

  function first(sql: string, b: unknown[]) {
    if (sql.startsWith("SELECT user_id, chapter_id, code_verifier")) {
      const [state] = b as [string];
      const row = transactions.find((t) => t.state === state && t.provider === "x");
      return row ?? null;
    }
    throw new Error(`Unhandled first SQL: ${sql}`);
  }

  function prepare(sql: string) {
    const stmt = {
      _bound: [] as unknown[],
      bind(...values: unknown[]) {
        stmt._bound = values;
        return stmt;
      },
      run: async () => run(sql, stmt._bound),
      first: async <T>() => first(sql, stmt._bound) as T,
      all: async () => ({ results: [] }),
    };
    return stmt;
  }

  return { db: { prepare } as unknown as D1Database, transactions, xAccounts };
}

const EXCHANGE: XTokenExchange = {
  token: { access_token: "at", refresh_token: "rt", expires_in: 7200 },
  user: { id: "x-user-1", username: "gdg_tokyo", name: "GDG Tokyo", profile_image_url: "img" },
};

function makeDeps(db: D1Database, over: Partial<XOAuthDependencies> = {}): XOAuthDependencies {
  return {
    db,
    randomState: () => "state-1",
    randomVerifier: () => "verifier-1",
    authorizationUrl: vi.fn(
      async (state: string, verifier: string) => `https://x.example/auth?s=${state}&v=${verifier}`,
    ),
    exchangeCode: vi.fn(async () => EXCHANGE),
    encryptToken: vi.fn(async (plaintext: string) => `enc(${plaintext})`),
    now: () => "2026-08-27T00:00:00.000Z",
    ...over,
  };
}

function tx(over: Partial<TxRow> = {}): TxRow {
  return {
    state: "state-1",
    provider: "x",
    user_id: "u1",
    chapter_id: 1,
    code_verifier: "verifier-1",
    return_to: "/settings",
    expires_at: "2999-01-01T00:00:00.000Z",
    created_at: "t0",
    ...over,
  };
}

describe("beginXConnect", () => {
  it("persists a pending x transaction and returns the authorization URL", async () => {
    const { db, transactions } = makeDb();
    const deps = makeDeps(db);

    const { authorizationUrl } = await beginXConnect(deps, {
      userId: "u1",
      chapterId: 1,
      returnTo: "/settings",
    });

    expect(authorizationUrl).toBe("https://x.example/auth?s=state-1&v=verifier-1");
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      state: "state-1",
      provider: "x",
      user_id: "u1",
      chapter_id: 1,
      code_verifier: "verifier-1",
      return_to: "/settings",
    });
    expect(Date.parse(transactions[0].expires_at)).toBeGreaterThan(Date.now());
  });
});

describe("completeXConnect", () => {
  it("rejects a missing state or code before touching the database", async () => {
    const { db } = makeDb();
    const deps = makeDeps(db);
    await expect(
      completeXConnect(deps, { state: null, code: "c", userId: "u1", chapterId: 1 }),
    ).rejects.toThrow("Missing X OAuth response");
    await expect(
      completeXConnect(deps, { state: "s", code: null, userId: "u1", chapterId: 1 }),
    ).rejects.toBeInstanceOf(XOAuthError);
    expect(deps.exchangeCode).not.toHaveBeenCalled();
  });

  it("exchanges the code, upserts the account, and returns the stored return path", async () => {
    const { db, transactions, xAccounts } = makeDb({ transactions: [tx()] });
    const deps = makeDeps(db);

    const result = await completeXConnect(deps, {
      state: "state-1",
      code: "auth-code",
      userId: "u1",
      chapterId: 1,
    });

    expect(deps.exchangeCode).toHaveBeenCalledWith("auth-code", "verifier-1");
    expect(deps.encryptToken).toHaveBeenCalledWith("at");
    expect(deps.encryptToken).toHaveBeenCalledWith("rt");
    expect(result).toEqual({ returnTo: "/settings" });
    expect(xAccounts).toHaveLength(1);
    expect(xAccounts[0]).toMatchObject({ chapter_id: 1, x_user_id: "x-user-1" });
    // The transaction is consumed exactly once.
    expect(transactions).toHaveLength(0);
  });

  it("rejects a transaction belonging to another user", async () => {
    const { db } = makeDb({ transactions: [tx({ user_id: "someone-else" })] });
    const deps = makeDeps(db);
    await expect(
      completeXConnect(deps, { state: "state-1", code: "c", userId: "u1", chapterId: 1 }),
    ).rejects.toThrow("Invalid or expired X OAuth transaction");
    expect(deps.exchangeCode).not.toHaveBeenCalled();
  });

  it("rejects a transaction for another chapter", async () => {
    const { db } = makeDb({ transactions: [tx({ chapter_id: 2 })] });
    const deps = makeDeps(db);
    await expect(
      completeXConnect(deps, { state: "state-1", code: "c", userId: "u1", chapterId: 1 }),
    ).rejects.toBeInstanceOf(XOAuthError);
  });

  it("rejects an expired transaction (and still consumes it)", async () => {
    const { db, transactions } = makeDb({
      transactions: [tx({ expires_at: "2000-01-01T00:00:00.000Z" })],
    });
    const deps = makeDeps(db);
    await expect(
      completeXConnect(deps, { state: "state-1", code: "c", userId: "u1", chapterId: 1 }),
    ).rejects.toThrow("Invalid or expired X OAuth transaction");
    expect(transactions).toHaveLength(0);
  });

  it("rejects an unknown state", async () => {
    const { db } = makeDb();
    const deps = makeDeps(db);
    await expect(
      completeXConnect(deps, { state: "missing", code: "c", userId: "u1", chapterId: 1 }),
    ).rejects.toBeInstanceOf(XOAuthError);
  });
});
