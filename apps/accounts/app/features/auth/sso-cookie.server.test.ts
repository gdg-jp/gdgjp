import { afterEach, describe, expect, it, vi } from "vitest";
import { reconcileSsoCookie } from "./sso-cookie.server";

type Session = { id: string; token: string; expiresAt: string };

function fakeDb(sessions: Session[]) {
  const deleted: string[] = [];
  const statements: string[] = [];
  const db = {
    prepare(sql: string) {
      statements.push(sql);
      return {
        bind(token: string) {
          return {
            async first() {
              const row = sessions.find((s) => s.token === token);
              return row ? { id: row.id, expiresAt: row.expiresAt } : null;
            },
            async run() {
              if (sql.startsWith("DELETE")) deleted.push(token);
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
  return { db: db as unknown as D1Database, deleted, statements };
}

const future = new Date(Date.now() + 3_600_000).toISOString();
const past = new Date(Date.now() - 1_000).toISOString();

function env(db: D1Database, appUrl = "https://accounts.gdgs.jp") {
  return { DB: db, APP_URL: appUrl } as unknown as Env;
}

function navigation(cookie?: string, path = "/dashboard") {
  const headers = new Headers({ "sec-fetch-mode": "navigate" });
  if (cookie) headers.set("cookie", cookie);
  return new Request(`https://accounts.gdgs.jp${path}`, { headers });
}

const SESSION = "__Secure-gdgjp-accounts.session_token";

describe("reconcileSsoCookie", () => {
  it("issues the parent-domain hint for a navigation with a live session", async () => {
    const { db } = fakeDb([{ id: "sid-1", token: "tok1", expiresAt: future }]);
    const response = await reconcileSsoCookie(
      env(db),
      navigation(`${SESSION}=tok1.signature`),
      new Response("ok"),
    );
    const cookie = response.headers.getSetCookie().join("\n");
    expect(cookie).toContain("gdg_sid=sid-1");
    expect(cookie).toContain("Domain=gdgs.jp");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(await response.text()).toBe("ok");
  });

  it("leaves the response untouched when the hint already matches", async () => {
    const { db } = fakeDb([{ id: "sid-1", token: "tok1", expiresAt: future }]);
    for (const cookie of [
      `${SESSION}=tok1.signature; gdg_sid=sid-1`,
      `${SESSION}=tok1.signature; gdg_sid=sid-1 ; theme=dark`,
    ]) {
      const response = await reconcileSsoCookie(env(db), navigation(cookie), new Response("ok"));
      expect(response.headers.getSetCookie(), cookie).toEqual([]);
    }
  });

  it("leaves the response untouched without a session or a hint", async () => {
    const { db } = fakeDb([]);
    for (const cookie of [undefined, "gdg_sidX"]) {
      const response = await reconcileSsoCookie(env(db), navigation(cookie), new Response("ok"));
      expect(response.headers.getSetCookie(), String(cookie)).toEqual([]);
    }
  });

  it("adds nothing when a sign-out response meets a browser that has no hint", async () => {
    const { db } = fakeDb([]);
    const response = await reconcileSsoCookie(
      env(db),
      navigation(`${SESSION}=tok1.sig`),
      new Response(null, { headers: { "Set-Cookie": `${SESSION}=; Max-Age=0; Path=/` } }),
    );
    expect(response.headers.getSetCookie()).toEqual([`${SESSION}=; Max-Age=0; Path=/`]);
  });

  it("looks sessions up by token and ignores Set-Cookie headers without a value", async () => {
    const { db, statements } = fakeDb([{ id: "sid-1", token: "tok1", expiresAt: future }]);
    const response = await reconcileSsoCookie(
      env(db),
      navigation(`${SESSION}=tok1.signature; gdg_sid=sid-1`),
      new Response("ok", { headers: { "Set-Cookie": `${SESSION}X` } }),
    );
    expect(response.headers.getSetCookie()).toEqual([`${SESSION}X`]);
    expect(statements).toEqual([
      'SELECT "id", "expiresAt" FROM "session" WHERE "token" = ? LIMIT 1',
    ]);
  });

  it("clears the hint when the presented session has expired", async () => {
    const { db } = fakeDb([{ id: "sid-1", token: "tok1", expiresAt: past }]);
    const response = await reconcileSsoCookie(
      env(db),
      navigation(`${SESSION}=tok1.signature; gdg_sid=sid-1`),
      new Response("ok"),
    );
    expect(response.headers.getSetCookie().join("\n")).toMatch(/gdg_sid=;.*Max-Age=0/);
  });

  it("clears the hint when the response signs the browser out", async () => {
    const { db, deleted } = fakeDb([]);
    const response = await reconcileSsoCookie(
      env(db),
      new Request("https://accounts.gdgs.jp/auth/signout", {
        headers: { cookie: `${SESSION}=tok1.signature; gdg_sid=sid-1` },
      }),
      new Response(null, {
        status: 302,
        headers: { "Set-Cookie": `${SESSION}=; Max-Age=0; Path=/` },
      }),
    );
    expect(response.status).toBe(302);
    expect(response.headers.getSetCookie().join("\n")).toMatch(/gdg_sid=;.*Max-Age=0/);
    expect(deleted).toEqual([]);
  });

  it("follows a new session and ends the one it replaced", async () => {
    const { db, deleted } = fakeDb([{ id: "sid-2", token: "tok2", expiresAt: future }]);
    const response = await reconcileSsoCookie(
      env(db),
      new Request("https://accounts.gdgs.jp/oauth/google/callback", {
        headers: { cookie: `${SESSION}=tok1.sig; gdg_sid=sid-1` },
      }),
      new Response(null, {
        status: 302,
        headers: { "Set-Cookie": `${SESSION}=tok2.sig; Max-Age=1209600; Path=/` },
      }),
    );
    expect(deleted).toEqual(["tok1"]);
    expect(response.headers.getSetCookie().join("\n")).toContain("gdg_sid=sid-2");
  });

  it("checks OAuth endpoints even when they are not top-level navigations", async () => {
    const { db } = fakeDb([{ id: "sid-1", token: "tok1", expiresAt: future }]);
    const response = await reconcileSsoCookie(
      env(db),
      new Request("https://accounts.gdgs.jp/api/auth/oauth2/authorize?client_id=ost", {
        headers: { cookie: `${SESSION}=tok1.sig` },
      }),
      new Response(null, { status: 302 }),
    );
    expect(response.headers.getSetCookie().join("\n")).toContain("gdg_sid=sid-1");
  });

  it("ignores API calls that cannot change what a relying party sees", async () => {
    const { db } = fakeDb([]);
    const original = new Response("ok");
    const response = await reconcileSsoCookie(
      env(db),
      new Request("https://accounts.gdgs.jp/api/locale", {
        method: "POST",
        headers: { cookie: "gdg_sid=sid-1" },
      }),
      original,
    );
    expect(response).toBe(original);
  });

  it("uses a host-only, non-Secure cookie on localhost", async () => {
    const { db } = fakeDb([{ id: "sid-1", token: "tok1", expiresAt: future }]);
    const response = await reconcileSsoCookie(
      env(db, "http://localhost:5173"),
      navigation("gdgjp-accounts.session_token=tok1.sig"),
      new Response("ok"),
    );
    const cookie = response.headers.getSetCookie().join("\n");
    expect(cookie).toContain("gdg_sid=sid-1");
    expect(cookie).not.toContain("Domain=");
    expect(cookie).not.toContain("Secure");
  });

  describe("cookie details", () => {
    const NOW = Date.UTC(2026, 0, 1);
    const inAnHour = new Date(NOW + 3_600_500).toISOString();

    afterEach(() => {
      vi.useRealTimers();
    });

    function fixedTime() {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
    }

    it("sets the hint for exactly the session's remaining lifetime", async () => {
      fixedTime();
      const { db } = fakeDb([{ id: "sid-1", token: "tok1", expiresAt: inAnHour }]);
      const response = await reconcileSsoCookie(
        env(db),
        navigation(`${SESSION}=tok1.signature`),
        new Response("ok", { status: 201, statusText: "Created" }),
      );
      expect(response.headers.getSetCookie()).toEqual([
        "gdg_sid=sid-1; Path=/; HttpOnly; SameSite=Lax; Domain=gdgs.jp; Secure; Max-Age=3600",
      ]);
      expect(response.status).toBe(201);
      expect(response.statusText).toBe("Created");
    });

    it("clears the hint with an expired cookie on the same domain", async () => {
      fixedTime();
      const { db } = fakeDb([
        { id: "sid-1", token: "tok1", expiresAt: new Date(NOW).toISOString() },
      ]);
      const response = await reconcileSsoCookie(
        env(db),
        navigation(`${SESSION}=tok1.signature; gdg_sid=sid-1`),
        new Response("ok"),
      );
      expect(response.headers.getSetCookie()).toEqual([
        "gdg_sid=; Path=/; HttpOnly; SameSite=Lax; Domain=gdgs.jp; Secure; Max-Age=0",
      ]);
    });

    it("keeps the hint host-only on loopback and apex hosts", async () => {
      for (const appUrl of ["https://gdgs.jp", "http://127.0.0.1:5173", "http://[::1]:5173"]) {
        const { db } = fakeDb([{ id: "sid-1", token: "tok1", expiresAt: future }]);
        const response = await reconcileSsoCookie(
          env(db, appUrl),
          navigation(`${SESSION}=tok1.signature`),
          new Response("ok"),
        );
        expect(response.headers.getSetCookie().join("\n"), appUrl).not.toContain("Domain=");
      }
    });

    it("only checks a presented session on GET navigations and OAuth endpoints", async () => {
      const { db } = fakeDb([{ id: "sid-1", token: "tok1", expiresAt: future }]);
      const requests = [
        new Request("https://accounts.gdgs.jp/dashboard", {
          method: "POST",
          headers: { cookie: `${SESSION}=tok1.sig`, "sec-fetch-mode": "navigate" },
        }),
        new Request("https://accounts.gdgs.jp/dashboard", {
          headers: { cookie: `${SESSION}=tok1.sig`, "sec-fetch-mode": "cors" },
        }),
        new Request("https://accounts.gdgs.jp/api/auth/session", {
          headers: { cookie: `${SESSION}=tok1.sig` },
        }),
      ];
      for (const request of requests) {
        const original = new Response("ok");
        expect(await reconcileSsoCookie(env(db), request, original)).toBe(original);
      }
    });

    it("treats an issued session cookie with a past expiry or zero Max-Age as a sign-out", async () => {
      fixedTime();
      for (const issued of [
        `${SESSION}=tok2.sig; Path=/; expires=${new Date(NOW).toUTCString()}`,
        `${SESSION}=tok2.sig; Path=/;  max-age = 0`,
        `${SESSION}=tok2.sig; Path=/; Max-Age`,
      ]) {
        const { db } = fakeDb([{ id: "sid-2", token: "tok2", expiresAt: inAnHour }]);
        const response = await reconcileSsoCookie(
          env(db),
          navigation(`${SESSION}=tok1.sig; gdg_sid=sid-1`),
          new Response(null, { headers: { "Set-Cookie": issued } }),
        );
        expect(response.headers.getSetCookie().at(-1), issued).toMatch(/^gdg_sid=; /);
      }
    });

    it("follows an issued session whose cookie still lives, ignoring other cookies", async () => {
      fixedTime();
      const { db, deleted } = fakeDb([{ id: "sid-1", token: "tok1", expiresAt: inAnHour }]);
      const headers = new Headers();
      headers.append("Set-Cookie", "theme=dark; Path=/");
      headers.append("Set-Cookie", "broken");
      headers.append(
        "Set-Cookie",
        ` ${SESSION} = tok1.sig ; Max-Age=60; Expires=${new Date(NOW + 60_000).toUTCString()}`,
      );
      const response = await reconcileSsoCookie(
        env(db),
        navigation(`${SESSION}=tok1.sig; gdg_sid=sid-1`),
        new Response(null, { headers }),
      );
      expect(deleted).toEqual([]);
      expect(response.headers.getSetCookie().at(-1)).toBe(
        "gdg_sid=sid-1; Path=/; HttpOnly; SameSite=Lax; Domain=gdgs.jp; Secure; Max-Age=3600",
      );
    });

    it("ignores presented session cookies that are empty or not a token", async () => {
      const { db } = fakeDb([{ id: "sid-1", token: "tok1", expiresAt: future }]);
      for (const cookie of [
        `${SESSION}=; gdg_sid=sid-1`,
        `${SESSION}=%E0; gdg_sid=sid-1`,
        `${SESSION}=.sig; gdg_sid=sid-1`,
        `x${SESSION}=tok1.sig; gdg_sid=sid-1`,
      ]) {
        const response = await reconcileSsoCookie(env(db), navigation(cookie), new Response("ok"));
        expect(response.headers.getSetCookie(), cookie).toEqual([
          "gdg_sid=; Path=/; HttpOnly; SameSite=Lax; Domain=gdgs.jp; Secure; Max-Age=0",
        ]);
      }
    });
  });
});
