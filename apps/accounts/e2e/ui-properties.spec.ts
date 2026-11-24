import { type Server, createServer } from "node:http";
import {
  type UiProperty,
  action,
  checkUiProperty,
  exploreActions,
  invariant,
  runPlan,
} from "@gdgjp/ui-properties";
import { type Browser, type Page, expect, test } from "@playwright/test";
import {
  ACCOUNTS_URL,
  type AccountsWorld,
  REDIRECT_URI,
  RP_URL,
  addSession,
  authorizeUrl,
  createWorld,
  destroyWorld,
  newSession,
  privileges,
} from "./ui-properties-world";

test.describe.configure({ retries: 0 });

let callback: Server | undefined;

test.beforeAll(async () => {
  const { hostname, port } = new URL(REDIRECT_URI);
  callback = createServer((_request, response) => {
    response
      .writeHead(200, { "content-type": "text/html; charset=utf-8" })
      .end(
        `<!doctype html><title>Callback</title><main><h1>Callback reached</h1><a href="${ACCOUNTS_URL}/dashboard">Back to Accounts</a></main>`,
      );
  });
  await new Promise<void>((done) => callback?.listen(Number(port), hostname, done));
});

test.afterAll(async () => {
  await new Promise((done) => (callback ? callback.close(done) : done(undefined)));
});

const MEMBER_PAGES = [
  "/dashboard",
  "/settings/connected-apps",
  "/chapters",
  "/chapters/invites",
  "/developers/apps",
  "/developers/apps/new",
  "/settings/google-workspace",
] as const;
const ADMIN_PAGES = ["/admin/users", "/admin/chapters", "/admin/requests", "/admin/seed-clients"];

type PrivilegedPost = { path: string; form: Record<string, string> };
const PRIVILEGED_POSTS = (world: AccountsWorld): PrivilegedPost[] => [
  { path: "/admin/users", form: { intent: "set-admin", userId: world.user.id, isAdmin: "true" } },
  { path: "/admin/users", form: { intent: "set-chapter", userId: world.user.id, chapterIds: "1" } },
  { path: "/admin/seed-clients", form: {} },
  {
    path: "/developers/apps/new",
    form: { name: "Property App", redirectUris: "https://example.com/callback" },
  },
];

const signedOutAfter = (location: string) => new URL(location, ACCOUNTS_URL).pathname === "/signin";

const property = (browser: Browser): UiProperty<AccountsWorld> => ({
  name: "accounts authorization and sign-in state",
  setup: createWorld(browser),
  teardown: destroyWorld,
  actions: [
    action<AccountsWorld, { path: (typeof MEMBER_PAGES)[number] }>({
      name: "visit account page",
      weight: 3,
      input: (random) => ({ path: random.pick(MEMBER_PAGES) }),
      run: async (world, input) => {
        const response = await world.page.goto(`${ACCOUNTS_URL}${input.path}`);
        if (!world.model.signedIn) {
          expect(new URL(world.page.url()).pathname, "signed out visits land on sign-in").toBe(
            "/signin",
          );
          return;
        }
        expect(response?.status()).toBe(200);
        if (input.path.startsWith("/developers/apps"))
          await expect(world.page.getByRole("button", { name: /create/i })).toHaveCount(0);
      },
    }),
    action<AccountsWorld, { path: string }>({
      name: "request admin page",
      weight: 2,
      input: (random) => ({ path: random.pick(ADMIN_PAGES) }),
      run: async (world, input) => {
        const response = await world.page.request.get(`${ACCOUNTS_URL}${input.path}`, {
          maxRedirects: 0,
        });
        if (world.model.signedIn) expect(response.status(), input.path).toBe(403);
        else {
          expect([302, 303]).toContain(response.status());
          expect(signedOutAfter(response.headers().location ?? "")).toBe(true);
        }
      },
    }),
    action<AccountsWorld, { index: number }>({
      name: "post a privileged form",
      weight: 2,
      input: (random) => ({ index: random.int(4) }),
      run: async (world, input) => {
        const post = PRIVILEGED_POSTS(world)[input.index] as PrivilegedPost;
        const response = await world.page.request.post(`${ACCOUNTS_URL}${post.path}`, {
          form: post.form,
          headers: { Origin: ACCOUNTS_URL },
          maxRedirects: 0,
        });
        if (world.model.signedIn) expect(response.status(), post.path).toBe(403);
        else expect([302, 303, 401, 403]).toContain(response.status());
      },
    }),
    action<AccountsWorld>({
      name: "sign in to accounts",
      weight: 2,
      enabled: (world) => !world.model.signedIn,
      run: async (world) => {
        await addSession(world.context, newSession(world));
        world.model.signedIn = true;
        await world.page.goto(`${ACCOUNTS_URL}/dashboard`);
      },
    }),
    action<AccountsWorld>({
      name: "sign out from the account menu",
      weight: 1,
      enabled: (world) => world.model.signedIn,
      run: async (world) => {
        await world.page.goto(`${ACCOUNTS_URL}/dashboard`);
        await world.ui.click(world.page.getByRole("button", { name: "Manage your account" }));
        await world.ui.click(world.page.getByRole("menuitem", { name: "Sign out" }));
        await world.page.waitForURL((url) => url.pathname === "/signin");
        world.model.signedIn = false;
        world.model.rp = false;
      },
    }),
    action<AccountsWorld>({
      name: "sign in to the relying party",
      weight: 2,
      enabled: (world) => world.model.signedIn && !world.model.rp,
      run: async (world) => {
        await world.page.goto(`${RP_URL}/api/auth/signin`, { waitUntil: "domcontentloaded" });
        expect(new URL(world.page.url()).origin).toBe(RP_URL);
        world.model.rp = true;
        await world.page.goto(`${ACCOUNTS_URL}/dashboard`);
      },
    }),
    action<AccountsWorld>({
      name: "sign out from the relying party",
      weight: 1,
      enabled: (world) => world.model.rp,
      run: async (world) => {
        await world.page.goto(`${RP_URL}/auth/signout`, { waitUntil: "domcontentloaded" });
        world.model.rp = false;
        world.model.signedIn = false;
        await world.page.goto(`${ACCOUNTS_URL}/dashboard`);
      },
    }),
    action<AccountsWorld>({
      name: "authorize the developer app",
      weight: 2,
      enabled: (world) => world.model.signedIn,
      run: async (world) => {
        await world.page.goto(authorizeUrl(world));
        if (!world.model.consented) {
          await expect(world.page).toHaveURL(/\/oauth\/consent\?/);
          await world.ui.click(world.page.getByRole("button", { name: "Allow and continue" }));
          world.model.consented = true;
        }
        await expect(world.page).toHaveURL(new RegExp(`^${REDIRECT_URI}\\?code=`));
      },
    }),
    action<AccountsWorld>({
      name: "decline the developer app",
      weight: 1,
      enabled: (world) => world.model.signedIn && !world.model.consented,
      run: async (world) => {
        await world.page.goto(authorizeUrl(world));
        await expect(world.page).toHaveURL(/\/oauth\/consent\?/);
        await world.ui.click(world.page.getByRole("button", { name: "Cancel" }));
        await expect(world.page).toHaveURL(new RegExp(`^${REDIRECT_URI}\\?`));
        expect(new URL(world.page.url()).searchParams.get("code")).toBeNull();
      },
    }),
    action<AccountsWorld>({
      name: "remove the app's access",
      weight: 1,
      enabled: (world) => world.model.signedIn && world.model.consented,
      run: async (world) => {
        await world.page.goto(`${ACCOUNTS_URL}/settings/connected-apps`);
        await expect(
          world.page.getByRole("heading", { level: 2, name: world.appName }),
        ).toBeVisible();
        await world.ui.click(world.page.getByRole("button", { name: "Remove access" }));
        await world.ui.click(
          world.page.getByRole("alertdialog").getByRole("button", { name: "Remove access" }),
        );
        await expect(world.page.getByText("No apps have access to your account.")).toBeVisible();
        world.model.consented = false;
      },
    }),
    ...exploreActions<AccountsWorld>().map((item) => ({
      ...item,
      weight: item.name === "use a control" ? 2 : 0.5,
      enabled: async (world: AccountsWorld) => world.model.signedIn && (await item.enabled(world)),
    })),
  ],
  invariants: [
    invariant(
      "accounts and the relying party agree with the modelled sign-in state",
      async (world) => {
        const session = await world.page.request.get(`${ACCOUNTS_URL}/api/auth/get-session`);
        expect(session.status()).toBe(200);
        const body = (await session.json()) as { user?: { id?: string } } | null;
        expect(body?.user?.id ?? null, "Accounts session").toBe(
          world.model.signedIn ? world.user.id : null,
        );
        const me = await world.page.request.get(`${RP_URL}/api/auth/me`);
        const rp = (await me.json()) as { user?: { email?: string } | null };
        expect(rp.user?.email ?? null, "relying party session").toBe(
          world.model.rp ? world.user.email : null,
        );
      },
    ),
    invariant("privileges never grow beyond what the model granted", async (world) => {
      const held = privileges(world);
      expect(held).toEqual({
        admin: 0,
        memberships: 0,
        clients: 0,
        consents: world.model.consented ? 1 : 0,
        consentsForClient: world.model.consented ? 1 : 0,
        sessions: world.model.signedIn ? 1 : 0,
      });
    }),
  ],
});

const plan = runPlan({ seeds: [2718, 16180], steps: 30, minutes: 6 });

for (const seed of plan.seeds) {
  test(`seed ${seed} never widens authorization and keeps sign-in state consistent`, async ({
    browser,
  }, testInfo) => {
    await checkUiProperty(testInfo, property(browser), {
      plan,
      seed,
      monitor: {
        origins: [ACCOUNTS_URL, RP_URL],
        ignoreConsole: [/^Failed to fetch manifest patches TypeError: Failed to fetch/],
      },
    });
  });
}
