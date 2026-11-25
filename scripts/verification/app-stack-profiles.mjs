export function devLogin(as, chapters = [], { admin = false, returnTo = "/" } = {}) {
  const query = new URLSearchParams({ as });
  for (const chapter of chapters) query.append("chapter", chapter);
  if (admin) query.set("admin", "1");
  query.set("return_to", returnTo);
  return `/dev/login?${query}`;
}

const kwansai = "1:gdg-kwansai:organizer";
const osaka = "2:gdgoc-osaka:organizer";

export const profiles = {
  pr: {
    directory: "apps/pr",
    port: 6161,
    companionPorts: [6162, 6163],
    mode: "dev",
    designSystem: true,
    d1: "gdgjp-pr-db",
    persistence: ".verification-pr-state",
    variables: { PR_RENDER_URL: "http://127.0.0.1:6163/snapshot" },
    companions: [
      {
        script: "pr-companions.mjs",
        env: { PR_VERIFY_CAPTURE_PORT: "6162", PR_VERIFY_RENDER_PORT: "6163" },
      },
    ],
    fonts: true,
    identities: {
      lead: { as: "lead", chapters: [kwansai] },
      osaka: { as: "osaka", chapters: [osaka] },
      cohost: { as: "cohost", chapters: [osaka] },
      member: { as: "kwansai-member", chapters: ["1:gdg-kwansai:member"] },
      outsider: { as: "outsider", chapters: ["3:other:organizer"] },
      admin: { as: "pr-admin", chapters: ["3:other:member"], admin: true },
    },
    probe: { identity: "lead", path: "/", text: "通知" },
    anonymous: { path: "/", redirect: "/signin" },
    fixtures: {
      brief: "skills/pr-playbook/examples/briefs/devfest-kansai-2026.json",
      xPostOutput: "skills/pr-x-post/references/example-output.json",
      captureServer: "http://127.0.0.1:6162",
      mockServices: "/dev/mock-services",
      cron: "/dev/cron?name=minute|hourly|weekly",
      runnerToken: "RUNNER_TOKEN in apps/pr/.dev.vars of the scratch checkout",
    },
    forbiddenVariables: ["PR_REAL_SERVICES"],
  },
  pay: {
    directory: "apps/pay",
    port: 6164,
    mode: "dev",
    designSystem: true,
    d1: "gdgjp-pay-db",
    variables: { TOKEN_ENCRYPTION_KEY: "verify-pay-token-encryption-key" },
    seed: "verify-pay/fixtures/seed.sql",
    r2: [
      {
        key: "gdgjp-pay-receipts/claims/clm_0000000000000000000000SEC2/fixture-receipt.png",
        file: "public/app-icon.png",
        contentType: "image/png",
      },
    ],
    identities: {
      organizer: { as: "organizer", chapters: ["1:gdg-tokyo:organizer"] },
      coorganizer: { as: "coorganizer", chapters: ["1:gdg-tokyo:organizer"] },
      member: { as: "member", chapters: ["1:gdg-tokyo:member"] },
      claimant: { as: "claimant", chapters: ["1:gdg-tokyo:member"] },
      outsider: { as: "outsider", chapters: ["2:gdg-osaka:organizer"] },
      nochapter: { as: "nochapter", chapters: ["0:none:member"] },
    },
    probe: { identity: "organizer", path: "/", text: 'aria-label="イベント一覧"' },
    anonymous: { path: "/", text: 'aria-label="利用案内"' },
    forbiddenVariables: ["GEMINI_API_KEY", "RESEND_API_KEY", "GOOGLE_OAUTH_CLIENT_SECRET"],
  },
  sns: {
    directory: "apps/sns",
    port: 6165,
    mode: "dev",
    designSystem: false,
    d1: "gdgjp-sns-db",
    variables: {
      X_API_BASE_URL: "http://127.0.0.1:9",
      X_TOKEN_URL: "http://127.0.0.1:9/2/oauth2/token",
      X_AUTHORIZATION_URL: "http://127.0.0.1:9/i/oauth2/authorize",
      X_CLIENT_ID: "sns-verify-x-client",
      X_CLIENT_SECRET: "sns-verify-x-secret",
      TOKEN_ENCRYPTION_KEY: "sns-verify-token-key",
      GOOGLE_PHOTOS_IMPORT_TOKEN: "sns-verify-import-token",
    },
    seed: "verify-sns/fixtures/seed.sql",
    accountsSeed: "verify-sns/fixtures/accounts-seed.sql",
    identities: {
      organizer: { as: "verify-sns-organizer", chapters: ["1:dev-chapter:organizer"] },
      switcher: {
        as: "verify-sns-switcher",
        chapters: ["1:dev-chapter:organizer", "3:empty-chapter:organizer"],
      },
      contributor: { as: "verify-sns-contributor", chapters: ["1:dev-chapter:member"] },
      guest: { as: "verify-sns-guest", chapters: ["none"] },
      member: { as: "verify-sns-member", chapters: ["1:dev-chapter:member"] },
      admin: { as: "verify-sns-admin", chapters: ["1:dev-chapter:member"], admin: true },
      other: { as: "verify-sns-other", chapters: ["2:other-chapter:organizer"] },
    },
    probe: {
      identity: "organizer",
      path: "/settings",
      text: "このチャプターから投稿するアカウント",
    },
    anonymous: { path: "/posts", redirect: "/signin" },
    forbiddenVariables: ["GITHUB_ACTIONS_DISPATCH_TOKEN"],
  },
  connpass: {
    directory: "apps/connpass",
    port: 6166,
    companionPorts: [6167],
    mode: "dev",
    designSystem: false,
    d1: "gdgjp-connpass-db",
    seed: "verify-connpass/fixtures/seed.sql",
    companions: [{ args: ["./e2e/mock-idp.mjs"], env: { CONNPASS_E2E_IDP_PORT: "6167" } }],
    serverEnvironment: { CONNPASS_E2E_ACCOUNTS_URL: "http://127.0.0.1:6167" },
    accountsUrlVariable: "CONNPASS_E2E_ACCOUNTS_URL",
    accountsSeed: "verify-sns/fixtures/accounts-seed.sql",
    platformProbe: {
      bearer: "sns-verify-cli-organizer-token-0001",
      path: "/api/jobs/does-not-exist",
      status: 404,
      text: "not_found",
    },
    identities: {},
    bearer: {
      admin: "e2e-admin",
      organizer: "e2e-organizer",
      member: "e2e-member",
      outsider: "e2e-outsider",
      developerAppOrganizer: "e2e-developer-app-organizer",
    },
    probe: { bearer: "e2e-admin", path: "/api/admin/groups", text: '"groups"' },
    anonymous: { path: "/", text: "connpass.gdgs.jp" },
    forbiddenVariables: ["CONNPASS_BOT_EMAIL", "CONNPASS_BOT_PASSWORD", "LUMA_BOT_PASSWORD"],
  },
  scheduler: {
    directory: "apps/scheduler",
    port: 6168,
    mode: "built",
    designSystem: true,
    d1: "gdgjp-scheduler-db",
    seed: "verify-scheduler/fixtures/seed.sql",
    identities: {
      owner: { as: "verify-owner", chapters: ["1:dev-chapter:organizer"] },
      other: { as: "verify-other", chapters: ["1:dev-chapter:member"] },
    },
    probe: { identity: "owner", path: "/events", text: "My events — Scheduler" },
    anonymous: { path: "/", text: "Schedule a meeting" },
  },
  tinyurl: {
    directory: "apps/tinyurl",
    port: 6169,
    mode: "built",
    designSystem: true,
    d1: "gdgjp-tinyurl-db",
    variables: { GATEWAY_SHARED_SECRET: "verify-tinyurl-gateway-secret" },
    seed: "verify-tinyurl/fixtures/seed.sql",
    identities: {
      owner: { as: "owner", chapters: ["101:gdg-verify-tokyo:organizer"] },
      peer: { as: "peer", chapters: ["101:gdg-verify-tokyo:member"] },
      outsider: { as: "outsider", chapters: ["202:gdg-verify-osaka:organizer"] },
      admin: { as: "admin", chapters: ["202:gdg-verify-osaka:member"], admin: true },
      nochapter: { as: "nochapter", chapters: ["0:none"] },
      latecomer: { as: "latecomer", chapters: ["303:gdg-verify-sapporo:member"] },
    },
    probe: { identity: "owner", path: "/links", text: "Links — GDG Japan Links" },
    anonymous: { path: "/links", redirect: "/signin" },
  },
};

export function selectProfiles(value) {
  const names = String(value ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (!names.length) throw new Error(`Choose --app from ${Object.keys(profiles).join(", ")}`);
  for (const name of names) {
    if (!profiles[name]) throw new Error(`Unknown app: ${name}`);
  }
  return [...new Set(names)];
}

export function origin(name) {
  return `http://localhost:${profiles[name].port}`;
}

export function requiredPorts(names) {
  return [
    ...new Set(
      names.flatMap((name) => [profiles[name].port, ...(profiles[name].companionPorts ?? [])]),
    ),
  ];
}

export function identityLogins(name) {
  const profile = profiles[name];
  return Object.fromEntries(
    Object.entries(profile.identities).map(([label, identity]) => [
      label,
      {
        url: `${origin(name)}${devLogin(identity.as, identity.chapters, { admin: identity.admin })}`,
        userId: `dev-user-${identity.as}`,
        email: `${identity.as}@dev.local`,
        chapters: identity.chapters,
        admin: Boolean(identity.admin),
      },
    ]),
  );
}

export function forbiddenPresent(variables, names = []) {
  return names.filter((name) => (variables[name] ?? "").trim() !== "");
}
