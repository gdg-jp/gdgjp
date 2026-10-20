import { describe, expect, it } from "vitest";
import { reconcileSsoCookie } from "./sso-cookie.server";

type Session = { id: string; token: string; expiresAt: string };

function fakeDb(sessions: Session[]) {
  const deleted: string[] = [];
  const db = {
    prepare(sql: string) {
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
  return { db: db as unknown as D1Database, deleted };
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
    const response = await reconcileSsoCookie(
      env(db),
      navigation(`${SESSION}=tok1.signature; gdg_sid=sid-1`),
      new Response("ok"),
    );
    expect(response.headers.getSetCookie()).toEqual([]);
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
    const { db } = fakeDb([]);
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
});
