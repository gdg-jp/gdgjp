import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function executeSql(sql: string) {
  execFileSync(
    "pnpm",
    [
      "exec",
      "wrangler",
      "d1",
      "execute",
      "gdgjp-wiki-db",
      "--local",
      "--persist-to",
      process.env.WIKI_E2E_PERSIST_TO ?? ".wrangler/e2e-state",
      "--command",
      sql,
    ],
    {
      cwd: fileURLToPath(new URL("../..", import.meta.url)),
      stdio: "pipe",
    },
  );
}

function createPage(prefix: string, parent: { id: string; synced: boolean } | null = null) {
  const id = randomUUID();
  const title = `${prefix} ${id.slice(0, 8)}`;
  const slug = `lifecycle-${id}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const parentId = parent ? `'${parent.id}'` : "NULL";
  executeSql(
    `INSERT INTO pages (id, space_id, title_ja, title_en, slug, content_ja, content_en, author_id, last_edited_by, status, visibility, general_role, origin, parent_id, acl_synced_with_parent, created_at, updated_at) VALUES ('${id}', 'gdg-jp', '${title}', '${title}', '${slug}', 'Lifecycle fixture', 'Lifecycle fixture', 'e2e-admin-user-id', 'e2e-admin-user-id', 'published', 'restricted', 'viewer', 'human', ${parentId}, ${parent?.synced === false ? 0 : 1}, ${timestamp}, ${timestamp});`,
  );
  return { id, location: `/s/gdg-jp/wiki/${slug}`, title };
}

function matchesApi(url: URL, pathname: string) {
  return url.pathname.replace(/\.data$/u, "") === pathname;
}

function createCandidate(prefix: string) {
  const id = randomUUID();
  const query = `${prefix}-${id}`;
  const label = `${prefix} candidate ${id.slice(0, 8)}`;
  executeSql(
    `INSERT INTO user (id, name, email, created_at, updated_at) VALUES ('${id}', '${label}', '${query}@example.test', unixepoch(), unixepoch());`,
  );
  return { id, query, label };
}

async function openSharing(page: Page) {
  await expect(page.locator(".tiptap[contenteditable=true]").first()).toBeVisible();
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

async function visitPair(page: Page) {
  const first = createPage("Lifecycle first");
  const second = createPage("Lifecycle second");
  await page.goto(first.location);
  await expect(page.getByRole("heading", { level: 1, name: first.title })).toBeVisible();
  await page.getByRole("link", { name: second.title, exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: second.title })).toBeVisible();
  return { first, second };
}

test("the empty comment editor submits formatted JSON and clears after success", async ({
  adminPage: page,
}) => {
  const fixture = createPage("Lifecycle comment");
  await page.goto(fixture.location);
  const editor = page.locator(".tiptap[contenteditable=true]").first();
  await expect(editor).toBeVisible();
  const submit = page.getByRole("button", { name: "Comment", exact: true });
  await expect(submit).toBeDisabled();
  await editor.fill("Comment lifecycle verification");
  await editor.press("ControlOrMeta+A");
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  const response = page.waitForResponse(
    (candidate) =>
      candidate.url().includes("/api/comments") && candidate.request().method() === "POST",
  );
  await submit.click();
  const saved = await response;
  expect(saved.ok()).toBe(true);
  const body = new URLSearchParams(saved.request().postData() ?? "");
  expect(body.get("pageId")).toBe(fixture.id);
  expect(JSON.parse(body.get("contentJson") ?? "null")).toMatchObject({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Comment lifecycle verification", marks: [{ type: "bold" }] },
        ],
      },
    ],
  });
  await expect(page.getByText("Comment lifecycle verification", { exact: true })).toBeVisible();
  await expect(editor).toHaveText("");
  await expect(submit).toBeDisabled();
});

test("sharing clears old search results and ignores a candidate response after close", async ({
  adminPage: page,
}) => {
  const fixture = createPage("Lifecycle candidates");
  const alpha = createCandidate("alpha");
  const beta = createCandidate("beta");
  const betaRequested = deferred();
  const betaRelease = deferred();
  const betaHandled = deferred();
  const emptyRelease = deferred();
  await page.route(
    (url) => matchesApi(url, "/api/share-candidates"),
    async (route) => {
      const query = new URL(route.request().url()).searchParams.get("q");
      if (query !== alpha.query && query !== beta.query) await emptyRelease.promise;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      if (query === beta.query) {
        betaRequested.resolve();
        await betaRelease.promise;
      }
      await route.fulfill({ response });
      if (query === beta.query) betaHandled.resolve();
    },
  );
  try {
    await page.goto(fixture.location);
    await openSharing(page);
    const query = page.getByRole("combobox", { name: "Add user" });
    await query.fill(alpha.query);
    await expect(page.getByRole("option", { name: new RegExp(alpha.label) })).toBeVisible();
    await query.fill(beta.query);
    await betaRequested.promise;
    await expect(page.getByRole("option", { name: new RegExp(alpha.label) })).toBeHidden();
    await query.press("Escape");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    betaRelease.resolve();
    await betaHandled.promise;
    await openSharing(page);
    await query.focus();
    await expect(page.getByRole("option", { name: new RegExp(beta.label) })).toBeHidden();
    await query.fill(`absent-${randomUUID()}`);
    emptyRelease.resolve();
    await expect(page.getByRole("option")).toHaveCount(0);
  } finally {
    betaRelease.resolve();
    emptyRelease.resolve();
    executeSql(`DELETE FROM user WHERE id IN ('${alpha.id}', '${beta.id}');`);
  }
});

test("a page switch cannot display the previous page's access while the new access is loading", async ({
  adminPage: page,
}) => {
  const first = createPage("Lifecycle access first");
  const second = createPage("Lifecycle access second");
  const grant = await page.request.post(`/api/page-access/${first.id}`, {
    data: {
      intent: "batchGrant",
      targets: [{ type: "email", key: "first-only@example.test", label: "First page only" }],
      role: "viewer",
      notify: false,
    },
  });
  expect(grant.ok()).toBe(true);
  const requested = deferred();
  const release = deferred();
  await page.route(
    (url) => matchesApi(url, `/api/page-access/${second.id}`),
    async (route) => {
      const response = await route.fetch();
      requested.resolve();
      await release.promise;
      await route.fulfill({ response });
    },
  );
  try {
    await page.goto(first.location);
    await openSharing(page);
    await expect(page.getByText("First page only", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("link", { name: second.title, exact: true }).first().click();
    await openSharing(page);
    await requested.promise;
    await expect(page.getByRole("heading", { name: `Share "${second.title}"` })).toBeVisible();
    await expect(page.getByText("First page only", { exact: true })).toBeHidden();
    release.resolve();
    await expect(
      page.getByRole("heading", { name: "People with access", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("First page only", { exact: true })).toBeHidden();
  } finally {
    release.resolve();
  }
});

test("closing after a permission change preserves the descendant prompt and updates selected children", async ({
  adminPage: page,
}) => {
  const parent = createPage("Lifecycle parent");
  const synced = createPage("Lifecycle synced child", { id: parent.id, synced: true });
  const unsynced = createPage("Lifecycle unsynced child", { id: parent.id, synced: false });
  await page.goto(parent.location);
  const accessLoaded = page.waitForResponse(
    (response) =>
      matchesApi(new URL(response.url()), `/api/page-access/${parent.id}`) &&
      response.request().method() === "GET",
  );
  await openSharing(page);
  expect((await accessLoaded).ok()).toBe(true);
  const initialAccess = await page.request.get(`/api/page-access/${parent.id}`);
  expect(await initialAccess.json()).toMatchObject({
    descendantCount: 2,
    syncedDescendantCount: 1,
  });
  const accessRefreshed = page.waitForResponse(
    (response) =>
      matchesApi(new URL(response.url()), `/api/page-access/${parent.id}`) &&
      response.request().method() === "GET",
  );
  await page.locator("#general-access").click();
  await page.getByRole("option", { name: "Public", exact: true }).click();
  expect((await accessRefreshed).ok()).toBe(true);
  const changedAccess = await page.request.get(`/api/page-access/${parent.id}`);
  expect(await changedAccess.json()).toMatchObject({ generalAccess: "public" });
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  const prompt = page.getByRole("alertdialog", { name: "Update child page permissions?" });
  await expect(prompt).toBeVisible();
  await expect(
    prompt.getByText(
      "This page has 2 child pages. Apply these permissions to 1 synced child pages?",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(prompt.getByRole("button", { name: "Update synced child pages" })).toBeVisible();
  await prompt.getByRole("checkbox", { name: "Include unsynced child pages" }).check();
  const syncedResponse = page.waitForResponse(
    (response) =>
      matchesApi(new URL(response.url()), `/api/page-access/${parent.id}`) &&
      response.request().method() === "POST",
  );
  await prompt.getByRole("button", { name: "Update child pages", exact: true }).click();
  const result = await syncedResponse;
  expect(result.ok()).toBe(true);
  await expect(prompt.getByRole("status")).toHaveText(
    "Updated 2 pages. Skipped 0 unsynced pages and 0 pages you cannot manage.",
  );
  for (const child of [synced, unsynced]) {
    const response = await page.request.get(`/api/page-access/${child.id}`);
    expect(response.ok()).toBe(true);
    expect(await response.json()).toMatchObject({
      generalAccess: "public",
      aclSyncedWithParent: true,
    });
  }
  await prompt.getByRole("button", { name: "Close", exact: true }).click();
  await expect(prompt).toBeHidden();
  await openSharing(page);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(prompt).toBeHidden();
});

test("a late mutation response stays with its page after browser history navigation", async ({
  adminPage: page,
}) => {
  const { first, second } = await visitPair(page);
  const committed = deferred();
  const release = deferred();
  const handled = deferred();
  await page.route(
    (url) => matchesApi(url, `/api/page-access/${second.id}`),
    async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      committed.resolve();
      await release.promise;
      await route.fulfill({ response });
      handled.resolve();
    },
  );
  try {
    await openSharing(page);
    await page.locator("#general-access").click();
    await page.getByRole("option", { name: "Public", exact: true }).click();
    await committed.promise;
    await page.goBack();
    await expect(page.getByRole("heading", { name: `Share "${first.title}"` })).toBeVisible();
    release.resolve();
    await handled.promise;
    await expect(page.locator("#general-access")).toHaveText(/Restricted/u);
    for (const { fixture, generalAccess } of [
      { fixture: first, generalAccess: "restricted" },
      { fixture: second, generalAccess: "public" },
    ]) {
      const response = await page.request.get(`/api/page-access/${fixture.id}`);
      expect(response.ok()).toBe(true);
      expect(await response.json()).toMatchObject({ generalAccess });
    }
  } finally {
    release.resolve();
  }
});
