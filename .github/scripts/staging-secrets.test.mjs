import assert from "node:assert/strict";
import test from "node:test";
import {
  firstPartyClientSql,
  isCredentialColumn,
  scrubPlan,
} from "../../scripts/staging/scrub.mjs";
import {
  classifySecret,
  deriveSecret,
  externalKey,
  externalValues,
  hashClientSecret,
  stagingSecretsFor,
} from "../../scripts/staging/secrets.mjs";

const root = "r".repeat(48);

test("derived staging secrets are stable per slot and differ between slots", () => {
  const one = deriveSecret(root, "stg-1", "gdgjp-accounts:BETTER_AUTH_SECRET");
  assert.equal(one, deriveSecret(root, "stg-1", "gdgjp-accounts:BETTER_AUTH_SECRET"));
  assert.notEqual(one, deriveSecret(root, "stg-2", "gdgjp-accounts:BETTER_AUTH_SECRET"));
  assert.equal(Buffer.from(one, "base64").length, 32);
  const keyring = JSON.parse(
    deriveSecret(root, "stg-1", "gdgjp-agent:TOKEN_ENCRYPTION_KEYS", "keyring"),
  );
  assert.equal(Buffer.from(keyring[1], "base64").length, 32);
  assert.throws(() => deriveSecret("short", "stg-1", "x"), /at least 32/);
});

test("both ends of an OAuth client and of shared tokens derive the same value", () => {
  const accounts = classifySecret("TINYURL_CLIENT_SECRET", "gdgjp-accounts", {
    TINYURL_CLIENT_ID: "tinyurl",
  });
  const relyingParty = classifySecret("IDP_CLIENT_SECRET", "gdgjp-tinyurl", {
    IDP_CLIENT_ID: "tinyurl",
  });
  assert.deepEqual(accounts, relyingParty);
  assert.deepEqual(
    classifySecret("AGENTS_CLIENT_SECRET", "gdgjp-accounts", { AGENTS_CLIENT_ID: "agents" }),
    classifySecret("IDP_CLIENT_SECRET", "gdgjp-agent", { IDP_CLIENT_ID: "agents" }),
  );
  assert.deepEqual(
    classifySecret("AGENT_SERVICE_TOKEN", "gdgjp-wiki"),
    classifySecret("AGENT_SERVICE_TOKEN", "gdgjp-agent"),
  );
  assert.deepEqual(
    classifySecret("GDG_CLIENT_SECRET", "gdgjp-live-checkin").id,
    "client:live-checkin",
  );
  assert.equal(classifySecret("GOOGLE_CLIENT_SECRET", "gdgjp-accounts").kind, "external");
  assert.equal(classifySecret("RESEND_API_KEY", "gdgjp-pay").kind, "external");
  assert.equal(classifySecret("SOMETHING_NEW", "gdgjp-pay").kind, "unknown");
});

test("staging never receives a production value and reports gaps", () => {
  const plan = stagingSecretsFor({
    worker: "gdgjp-accounts",
    slot: "stg-1",
    productionSecrets: ["BETTER_AUTH_SECRET", "GOOGLE_CLIENT_SECRET", "RESEND_API_KEY", "NEW_ONE"],
    vars: {},
    root,
    external: { GOOGLE_CLIENT_SECRET: "staging-google", GOOGLE_CLIENT_ID: "staging-id" },
    config: {},
  });
  assert.equal(plan.secrets.GOOGLE_CLIENT_SECRET, "staging-google");
  assert.equal(
    plan.secrets.BETTER_AUTH_SECRET,
    deriveSecret(root, "stg-1", "gdgjp-accounts:BETTER_AUTH_SECRET"),
  );
  assert.deepEqual(plan.missingExternal, ["RESEND_API_KEY"]);
  assert.deepEqual(plan.unknown, ["NEW_ONE"]);
  assert.deepEqual(plan.varOverrides, { GOOGLE_CLIENT_ID: "staging-id" });
});

test("external staging values are read from per-worker GitHub secrets", () => {
  assert.equal(
    externalKey("gdgjp-tinyurl-gateway", "VERCEL_TOKEN"),
    "STAGING_EXT__TINYURL_GATEWAY__VERCEL_TOKEN",
  );
  assert.deepEqual(
    externalValues("gdgjp-accounts", {
      STAGING_EXT__ACCOUNTS__GOOGLE_CLIENT_SECRET: "a",
      STAGING_EXT__ACCOUNTS__EMPTY: "",
      STAGING_EXT__WIKI__GEMINI_API_KEY: "b",
      CLOUDFLARE_API_TOKEN: "c",
    }),
    { GOOGLE_CLIENT_SECRET: "a" },
  );
});

test("client secret hashes match Accounts' SHA-256 base64url storage", () => {
  assert.equal(hashClientSecret("abc"), "ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0");
  assert.deepEqual(firstPartyClientSql([{ clientId: "o'k", secretHash: "h" }]), [
    `UPDATE "oauthClient" SET "clientSecret" = 'h' WHERE "clientId" = 'o''k';`,
  ]);
});

test("sync removes credentials and refuses unreviewed credential columns", () => {
  const accounts = scrubPlan("gdgjp-accounts-db", {
    session: ["id", "token"],
    jwks: ["id", "publicKey", "privateKey"],
    account: ["id", "accessToken", "refreshToken", "idToken", "password"],
    oauthAccessToken: ["token"],
    oauthRefreshToken: ["token"],
    googleWorkspaceConnection: ["refreshTokenCiphertext", "refreshTokenNonce"],
    verification: ["value"],
  });
  assert.deepEqual(accounts.unreviewed, []);
  for (const table of ["session", "jwks", "oauthAccessToken", "oauthRefreshToken"])
    assert.ok(accounts.statements.includes(`DELETE FROM "${table}";`), table);
  const wiki = scrubPlan("gdgjp-wiki-db", {
    oidc_session: ["access_token", "refresh_token", "id_token", "access_token_expires_at"],
    google_drive_tokens: ["access_token", "refresh_token"],
    new_table: ["api_key"],
  });
  assert.deepEqual(wiki.unreviewed, ["new_table.api_key"]);
  assert.ok(wiki.statements.includes('DELETE FROM "oidc_session";'));
  assert.ok(wiki.statements.includes('DELETE FROM "google_drive_tokens";'));
  assert.ok(!wiki.statements.some((sql) => sql.includes("fcm_tokens")));
  assert.ok(isCredentialColumn("discord_webhook_cipher"));
  assert.ok(!isCredentialColumn("title"));
});
