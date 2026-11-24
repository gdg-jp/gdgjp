const chapter = "1:dev-chapter";
const otherChapter = "2:other-chapter";
const noChapter = "0:none";

function login(as, chapters, returnTo) {
  const query = new URLSearchParams({ as });
  for (const value of chapters) query.append("chapter", value);
  query.set("return_to", returnTo);
  return `/dev/login?${query}`;
}

export const applications = {
  screen: {
    directory: "apps/screen",
    port: 6188,
    d1: "gdgjp-screen-db",
    mode: "built",
    designSystem: true,
    build: ["exec", "react-router", "build"],
    anonymous: { path: "/not-a-token/", text: "routes/$invite" },
    identities: {
      operator: {
        as: "verify-op",
        chapters: [chapter],
        probe: { path: "/", text: "verify-op (dev)" },
      },
    },
    seeds: [],
    gated: "/",
  },
  ost: {
    directory: "apps/ost",
    port: 6185,
    d1: "gdgjp-ost-db",
    mode: "built",
    designSystem: false,
    build: ["exec", "react-router", "build"],
    anonymous: { path: "/verify-ost", text: "Verify OST" },
    identities: {
      owner: { as: "verify-owner", chapters: [chapter], probe: { path: "/", text: "Verify OST" } },
      outsider: {
        as: "verify-outsider",
        chapters: [otherChapter],
        probe: { path: "/", text: "other-chapter" },
      },
    },
    seeds: [
      { path: `/dev/seed?slug=verify-ost&title=Verify%20OST&chapter=${chapter}` },
      { path: `/dev/seed?slug=verify-ost-layout&title=Verify%20Layout&chapter=${chapter}` },
    ],
    gated: "/verify-ost/screen",
  },
  mc: {
    directory: "apps/mc",
    port: 6187,
    d1: "gdgjp-mc-db",
    mode: "built",
    designSystem: true,
    build: ["exec", "react-router", "build"],
    anonymous: { path: "/play?track=A&t=invalid", text: "mc player" },
    identities: {
      operator: { as: "verify-mc", chapters: [chapter], probe: { path: "/", text: "音声を追加" } },
      outsider: {
        as: "verify-mc-outsider",
        chapters: [otherChapter],
        probe: { path: "/", text: "音声を追加" },
      },
      "no-chapter": {
        as: "verify-mc-nochapter",
        chapters: [noChapter],
        probe: { path: "/", redirect: "/no-chapter" },
      },
    },
    seeds: [],
    gated: "/",
  },
  deck: {
    directory: "apps/deck",
    port: 6189,
    d1: "gdgjp-deck-db",
    mode: "built",
    designSystem: true,
    build: ["exec", "react-router", "build"],
    anonymous: { path: "/dock/missing?t=invalid", text: "この URL は使えません" },
    identities: {
      member: {
        as: "verify-deck",
        chapters: [chapter],
        probe: { path: "/", text: "デッキを作成" },
      },
      member2: {
        as: "verify-deck-2",
        chapters: [`${chapter}:member`],
        probe: { path: "/", text: "デッキを作成" },
      },
      outsider: {
        as: "verify-deck-outsider",
        chapters: [otherChapter],
        probe: { path: "/", text: "まだデッキがありません。" },
      },
    },
    seeds: [],
    gated: "/",
    companions: [{ name: "fake-obs", args: ["e2e/fake-obs.ts", "4467"], port: 4467 }],
  },
  roulette: {
    directory: "apps/roulette",
    port: 6190,
    d1: "gdgjp-roulette-db",
    mode: "built",
    designSystem: true,
    build: ["exec", "react-router", "build"],
    anonymous: { path: "/api/auth/me", text: '"user":null' },
    identities: {
      organizer: {
        as: "verify-roulette",
        chapters: [chapter],
        probe: { path: "/", text: "プロジェクト — GDG Roulette" },
      },
      outsider: {
        as: "verify-roulette-outsider",
        chapters: [otherChapter],
        probe: { path: "/", text: "プロジェクト — GDG Roulette" },
      },
    },
    seeds: [],
    gated: "/",
  },
  img: {
    directory: "apps/img",
    port: 6175,
    d1: "gdgjp-img-db",
    mode: "dev",
    designSystem: true,
    anonymous: { path: "/api/auth/me", text: '"user":null' },
    identities: {
      member: {
        as: "verify-img",
        chapters: [chapter],
        probe: { path: "/", text: "Chapter image library" },
      },
      peer: {
        as: "verify-img-peer",
        chapters: [`${chapter}:member`],
        probe: { path: "/", text: "Chapter image library" },
      },
      outsider: {
        as: "verify-img-outsider",
        chapters: [otherChapter],
        probe: { path: "/", text: "Chapter image library" },
      },
    },
    seeds: [],
    gated: "/",
  },
  meet: {
    directory: "apps/meet",
    port: 6193,
    d1: "gdgjp-meet-db",
    mode: "dev",
    designSystem: true,
    anonymous: { path: "/api/auth/me", text: '"user":null' },
    identities: {
      member: { as: "verify-meet", chapters: [chapter], probe: { path: "/", text: "新しい会議" } },
    },
    seeds: [],
    gated: "/",
  },
  website: {
    directory: "apps/website",
    port: 6180,
    mode: "dev",
    designSystem: false,
    anonymous: { path: "/", text: "コミュニティの活動を、もっと身近に。" },
    identities: {},
    seeds: [],
  },
  roster: {
    directory: "apps/roster",
    port: 6186,
    d1: "gdgjp-roster-db",
    mode: "built",
    designSystem: true,
    build: ["exec", "react-router", "build"],
    anonymous: { path: "/favicon.svg", text: "<svg" },
    identities: {
      owner: {
        as: "verify-roster",
        chapters: [chapter],
        probe: { path: "/", text: "所属するChapterのスタッフシフトを管理します。" },
      },
      staff: {
        as: "verify-roster-staff",
        chapters: [otherChapter],
        probe: { path: "/", text: "所属するChapterのスタッフシフトを管理します。" },
      },
      staff2: {
        as: "verify-roster-staff2",
        chapters: [otherChapter],
        probe: { path: "/", text: "所属するChapterのスタッフシフトを管理します。" },
      },
    },
    seeds: [],
    gated: "/",
  },
  "live-checkin": {
    directory: "apps/live-checkin",
    port: 6194,
    mode: "next",
    designSystem: false,
    anonymous: { path: "/", text: "GDG Accounts でログイン" },
    identities: {
      kwansai: { cookie: true, probe: { path: "/checkin", text: "checkin | GDG受付システム" } },
      outsider: { cookie: true, probe: { path: "/checkin", redirect: "/forbidden" } },
    },
    seeds: [],
  },
};

export function origin(name) {
  return `http://localhost:${applications[name].port}`;
}

export function identityLogin(name, identity) {
  const { as, chapters, probe } = applications[name].identities[identity];
  return login(as, chapters, probe.path);
}

export function selectApplications(value) {
  const names = String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!names.length) throw new Error("Select at least one application with --app");
  for (const name of names) {
    if (!Object.hasOwn(applications, name)) {
      throw new Error(
        `Unknown application ${name}; choose from ${Object.keys(applications).join(", ")}`,
      );
    }
  }
  return [...new Set(names)];
}

export function requiredPorts(names) {
  return names.flatMap((name) => [
    applications[name].port,
    ...(applications[name].companions ?? []).map(({ port }) => port),
  ]);
}
