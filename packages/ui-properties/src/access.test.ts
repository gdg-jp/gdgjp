import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { accessScope, accessToken, browserEnvironment, fuzzAccess, inAccessScope } from "./access";

describe("the Access scope", () => {
  it("credentials only https origins on the slot domain, and loopback only when named", () => {
    const loopback = accessScope({
      domain: "stg1.gdgs.jp",
      localOrigins: ["http://127.0.0.1:6100"],
    });
    const table: [string, boolean][] = [
      ["https://wiki.stg1.gdgs.jp/", true],
      ["https://stg1.gdgs.jp/x", true],
      ["HTTPS://WIKI.STG1.GDGS.JP/page", true],
      ["https://wiki.stg1.gdgs.jp:443/", true],
      ["https://xn--wki-yla.stg1.gdgs.jp/", true],
      ["http://wiki.stg1.gdgs.jp/", false],
      ["http://wiki.stg1.gdgs.jp:443/", false],
      ["https://wiki.stg1.gdgs.jp:8443/", false],
      ["https://wiki.stg1.gdgs.jp./", false],
      ["https://user:pass@wiki.stg1.gdgs.jp/", false],
      ["https://user@wiki.stg1.gdgs.jp/", false],
      ["wss://wiki.stg1.gdgs.jp/socket", false],
      ["ws://wiki.stg1.gdgs.jp/socket", false],
      ["https://evilstg1.gdgs.jp/", false],
      ["https://stg1.gdgs.jp.example.com/", false],
      ["https://wiki.stg2.gdgs.jp/", false],
      ["https://wiki.stg1.gdgs.xn--j1ay/", false],
      ["https://example.com/", false],
      ["http://localhost/", false],
      ["http://127.0.0.1:6100/x", true],
      ["https://127.0.0.1:6100/", false],
      ["http://127.0.0.1:6101/", false],
      ["http://user@127.0.0.1:6100/", false],
      ["not a url", false],
    ];
    for (const [url, expected] of table)
      expect([url, inAccessScope(loopback, url)]).toEqual([url, expected]);
    expect(inAccessScope(accessScope({ domain: "stg1.gdgs.jp" }), "http://127.0.0.1:6100/")).toBe(
      false,
    );
    expect(() => accessScope({ localOrigins: ["http://wiki.stg1.gdgs.jp"] })).toThrow(/loopback/);
    expect(() => accessScope({ localOrigins: ["http://127.0.0.1:6100/x"] })).toThrow(/loopback/);
    expect(() => accessScope({ domain: "localhost" })).toThrow(/Invalid slot domain/);
    expect(() => accessScope({ domain: "gdgs.jp." })).toThrow(/Invalid slot domain/);
  });

  it("decides the upstream from the run's configuration and rejects plain http targets", () => {
    const secretEnv = { CF_ACCESS_CLIENT_ID: "i", CF_ACCESS_CLIENT_SECRET: "s" };
    expect(
      fuzzAccess({ ...secretEnv, UI_FUZZ_DOMAIN: "stg1.gdgs.jp" }, [
        "https://wiki.stg1.gdgs.jp",
        "https://accounts.stg1.gdgs.jp",
      ]),
    ).toEqual({ scope: { domain: "stg1.gdgs.jp", localOrigins: [] }, upstream: { kind: "dns" } });
    expect(() =>
      fuzzAccess({ ...secretEnv, UI_FUZZ_DOMAIN: "stg1.gdgs.jp" }, ["http://wiki.stg1.gdgs.jp"]),
    ).toThrow(/only goes to https origins/);
    expect(() => fuzzAccess(secretEnv, ["http://localhost:6100"])).toThrow(/only goes to https/);
    expect(() =>
      fuzzAccess({ ...secretEnv, UI_FUZZ_DOMAIN: "stg.fuzz.test" }, ["https://a.stg.fuzz.test"]),
    ).toThrow(/test domain/);
    const ca = join(mkdtempSync(join(tmpdir(), "ui-fuzz-ca-")), "ca.pem");
    writeFileSync(ca, "pem");
    const local = {
      ...secretEnv,
      UI_FUZZ_LOCAL: "1",
      UI_FUZZ_DOMAIN: "stg.fuzz.test",
      UI_FUZZ_LOCAL_UPSTREAM: "127.0.0.1:6100",
      UI_FUZZ_LOCAL_CA: ca,
    };
    expect(fuzzAccess(local, ["https://demo.stg.fuzz.test"])).toEqual({
      scope: { domain: "stg.fuzz.test", localOrigins: [] },
      upstream: { kind: "loopback", address: "127.0.0.1", port: 6100, ca: Buffer.from("pem") },
    });
    expect(() => fuzzAccess(local, ["http://localhost:6100"])).toThrow(/only goes to https/);
    expect(() => fuzzAccess({ ...local, UI_FUZZ_DOMAIN: "stg1.gdgs.jp" }, [])).toThrow(/\.test/);
    expect(() => fuzzAccess({ ...local, UI_FUZZ_LOCAL_UPSTREAM: "10.0.0.1:443" }, [])).toThrow(
      /127\.x/,
    );
    expect(() => fuzzAccess({ ...local, UI_FUZZ_LOCAL_CA: "" }, [])).toThrow(/UI_FUZZ_LOCAL_CA/);
    expect(fuzzAccess({}, ["http://127.0.0.1:6100"]).upstream).toEqual({ kind: "dns" });
    expect(
      browserEnvironment({ PATH: "/bin", CF_ACCESS_CLIENT_ID: "i", CF_ACCESS_CLIENT_SECRET: "s" }),
    ).toEqual({ PATH: "/bin" });
    expect(accessToken({ CF_ACCESS_CLIENT_ID: "i" })).toBeNull();
    expect(accessToken(secretEnv)).toEqual({ id: "i", secret: "s" });
  });
});
