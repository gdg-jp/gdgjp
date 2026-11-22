import { describe, expect, it } from "vitest";
import { isLocalDev } from "./local";

describe("isLocalDev", () => {
  it.each(["localhost", "127.0.0.1", "[::1]"])(
    "allows explicitly enabled development routes on %s",
    (host) => {
      expect(
        isLocalDev({ ENVIRONMENT: "development" }, new Request(`http://${host}:6191/dev/cron`)),
      ).toBe(true);
    },
  );

  it.each(["production", "preview", "staging", "developmnt", "", undefined])(
    "denies development routes when ENVIRONMENT is %s",
    (environment) => {
      expect(
        isLocalDev({ ENVIRONMENT: environment }, new Request("http://localhost:6191/dev/cron")),
      ).toBe(false);
    },
  );

  it.each(["pr.gdgs.jp", "localhost.example.com", "127.0.0.1.example.com"])(
    "denies development routes on %s even in development",
    (host) => {
      expect(
        isLocalDev({ ENVIRONMENT: "development" }, new Request(`https://${host}/dev/cron`)),
      ).toBe(false);
    },
  );
});
