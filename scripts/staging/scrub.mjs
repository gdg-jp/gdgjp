const CREDENTIAL_COLUMN =
  /(token|secret|password|private|cipher|_enc$|credential|nonce|cookie|webhook|api_?key)/i;

const RP_DATABASES = [
  "gdgjp-deck-db",
  "gdgjp-img-db",
  "gdgjp-mc-db",
  "gdgjp-meet-db",
  "gdgjp-ost-db",
  "gdgjp-pay-db",
  "gdgjp-pr-db",
  "gdgjp-roster-db",
  "gdgjp-roulette-db",
  "gdgjp-scheduler-db",
  "gdgjp-screen-db",
  "gdgjp-sns-db",
  "gdgjp-tinyurl-db",
  "gdgjp-wiki-db",
];

const OIDC_SESSION = {
  scrub: ['DELETE FROM "oidc_session";'],
  reviewed: [
    "oidc_session.access_token",
    "oidc_session.refresh_token",
    "oidc_session.id_token",
    "oidc_session.access_token_expires_at",
  ],
};

const LEGACY_BETTER_AUTH = {
  scrub: [
    'DELETE FROM "session";',
    'UPDATE "account" SET "accessToken" = NULL, "refreshToken" = NULL, "idToken" = NULL, "password" = NULL;',
  ],
  reviewed: [
    "session.token",
    "account.accessToken",
    "account.refreshToken",
    "account.idToken",
    "account.accessTokenExpiresAt",
    "account.refreshTokenExpiresAt",
    "account.password",
    "verification.value",
  ],
};

export const SCRUB = {
  "gdgjp-accounts-db": {
    scrub: [
      'DELETE FROM "session";',
      'DELETE FROM "oauthAccessToken";',
      'DELETE FROM "oauthRefreshToken";',
      'DELETE FROM "jwks";',
      'DELETE FROM "googleWorkspaceConnection";',
      'DELETE FROM "verification";',
      'UPDATE "account" SET "accessToken" = NULL, "refreshToken" = NULL, "idToken" = NULL, "password" = NULL;',
    ],
    reviewed: [
      "session.token",
      "account.accessToken",
      "account.refreshToken",
      "account.idToken",
      "account.accessTokenExpiresAt",
      "account.refreshTokenExpiresAt",
      "account.password",
      "jwks.publicKey",
      "jwks.privateKey",
      "oauthClient.clientSecret",
      "oauthClient.tokenEndpointAuthMethod",
      "oauthClient.clientCredentialsScopes",
      "oauthClient.dpopBoundAccessTokens",
      "oauthRefreshToken.token",
      "oauthAccessToken.token",
      "oauthAccessToken.refreshId",
      "googleWorkspaceConnection.refreshTokenCiphertext",
      "googleWorkspaceConnection.refreshTokenNonce",
      "chapter_invites.token",
      "oauthResource.accessTokenTtl",
      "oauthResource.refreshTokenTtl",
      "oauthResource.dpopBoundAccessTokensRequired",
      "verification.value",
    ],
  },
  "gdgjp-agent-db": {
    scrub: ['DELETE FROM "account_links";'],
    reviewed: [],
  },
  "gdgjp-deck-db": { scrub: [], reviewed: ["deck.dock_token"] },
  "gdgjp-meet-db": {
    scrub: ['DELETE FROM "google_connection";'],
    reviewed: [
      "google_connection.refresh_token_ciphertext",
      "google_connection.refresh_token_nonce",
    ],
  },
  "gdgjp-pay-db": {
    scrub: ['DELETE FROM "google_oauth_tokens";'],
    reviewed: [
      "google_oauth_tokens.access_token_enc",
      "google_oauth_tokens.refresh_token_enc",
      "google_oauth_tokens.access_token_expires_at",
      "profiles.account_number_enc",
      "claims.account_number_enc",
    ],
  },
  "gdgjp-pr-db": {
    scrub: ['UPDATE "chapter_settings" SET "discord_webhook_cipher" = NULL;'],
    reviewed: ["chapter_settings.discord_webhook_cipher"],
  },
  "gdgjp-roster-db": { scrub: [], reviewed: ["events.apply_token", "events.view_token"] },
  "gdgjp-scheduler-db": {
    scrub: LEGACY_BETTER_AUTH.scrub,
    reviewed: ["event_participants.edit_token_hash", ...LEGACY_BETTER_AUTH.reviewed],
  },
  "gdgjp-screen-db": { scrub: [], reviewed: ["stage.invite_token", "stage.output_token"] },
  "gdgjp-sns-db": {
    scrub: [
      'UPDATE "x_accounts" SET "access_token_ciphertext" = \'\', "refresh_token_ciphertext" = NULL, "access_token_expires_at" = NULL;',
    ],
    reviewed: [
      "x_accounts.access_token_ciphertext",
      "x_accounts.refresh_token_ciphertext",
      "x_accounts.access_token_expires_at",
    ],
  },
  "gdgjp-img-db": { scrub: LEGACY_BETTER_AUTH.scrub, reviewed: LEGACY_BETTER_AUTH.reviewed },
  "gdgjp-tinyurl-db": { scrub: LEGACY_BETTER_AUTH.scrub, reviewed: LEGACY_BETTER_AUTH.reviewed },
  "gdgjp-wiki-db": {
    scrub: [
      ...LEGACY_BETTER_AUTH.scrub,
      'DELETE FROM "google_drive_tokens";',
      'DELETE FROM "discord_oauth_tokens";',
      'DELETE FROM "fcm_tokens";',
      'DELETE FROM "job_tokens";',
      'DELETE FROM "knowledge_items";',
    ],
    reviewed: [
      ...LEGACY_BETTER_AUTH.reviewed,
      "google_drive_tokens.access_token",
      "google_drive_tokens.refresh_token",
      "discord_oauth_tokens.access_token",
      "discord_oauth_tokens.refresh_token",
      "fcm_tokens.token",
      "job_tokens.token_hash",
      "sources.next_page_token",
    ],
  },
};

export const UNCOPIED_KV_TITLES = new Set([
  "gdgjp-mcp-oauth",
  "gdgjp-connpass-session",
  "gdgjp-agent-kv",
]);

export function isCredentialColumn(column) {
  return CREDENTIAL_COLUMN.test(column);
}

export function scrubPlan(database, tables) {
  const plan = SCRUB[database] ?? { scrub: [], reviewed: [] };
  const withSession = RP_DATABASES.includes(database)
    ? { scrub: [...OIDC_SESSION.scrub], reviewed: [...OIDC_SESSION.reviewed] }
    : { scrub: [], reviewed: [] };
  const reviewed = new Set([...plan.reviewed, ...withSession.reviewed]);
  const present = new Set(Object.keys(tables));
  const unreviewed = Object.entries(tables)
    .flatMap(([table, columns]) =>
      columns.filter(isCredentialColumn).map((column) => `${table}.${column}`),
    )
    .filter((column) => !reviewed.has(column))
    .sort();
  const statements = [...withSession.scrub, ...plan.scrub].filter((sql) => {
    const table = /(?:FROM|UPDATE) "([^"]+)"/.exec(sql)?.[1];
    return !table || present.has(table);
  });
  return { statements, unreviewed };
}

export function firstPartyClientSql(clients) {
  return clients.map(
    ({ clientId, secretHash }) =>
      `UPDATE "oauthClient" SET "clientSecret" = '${secretHash.replaceAll("'", "''")}' WHERE "clientId" = '${clientId.replaceAll("'", "''")}';`,
  );
}
