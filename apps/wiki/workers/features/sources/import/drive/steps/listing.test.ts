import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSourcesTestDb } from "../../../test-db";

const { db, sqlite } = createSourcesTestDb();

vi.mock("../../../../../../app/lib/db.server", () => ({ getDb: () => db }));
vi.mock("../../../../../../app/features/google/drive-token.server", () => ({
  getGoogleDriveTokenRow: vi.fn().mockResolvedValue({
    accessToken: "token-1",
    grantedScopes: "https://www.googleapis.com/auth/drive.readonly",
  }),
}));
vi.mock("../../../../../../app/features/knowledge/sync.server", () => ({
  scheduleKnowledgeSync: vi.fn(),
}));
vi.mock("../../../../../../app/features/jobs/enqueue.server", () => ({
  enqueueSynthesizeForSource: vi.fn(),
}));

import { SubrequestBudget } from "../../../subrequest-budget";
import { type SourceImportClaimRequest, claimSourceImport, startSourceImport } from "../../run";
import { memorySql } from "../../test-do-sql";
import { advanceSourceImportTick } from "../../tick";

const DOC = "application/vnd.google-apps.document";
const SHEET = "application/vnd.google-apps.spreadsheet";
const SLIDES = "application/vnd.google-apps.presentation";
const FOLDER = "application/vnd.google-apps.folder";
const PDF = new TextEncoder().encode("%PDF-1.4 test");

type Item = Record<string, unknown>;

function docJson(text: string) {
  return {
    documentId: "x",
    title: "x",
    body: { content: [{ paragraph: { elements: [{ textRun: { content: `${text}\n` } }] } }] },
  };
}

/** A fake Google API: folder id → children, plus the per-file endpoints the steps call. */
function stubGoogle(folders: Record<string, Item[]>, metadata: { name: string; mimeType: string }) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input));
    const path = url.pathname;
    if (url.hostname === "www.googleapis.com" && path === "/drive/v3/files") {
      const parent = url.searchParams.get("q")?.match(/^'([^']+)' in parents/)?.[1] ?? "";
      expect(url.searchParams.get("includeItemsFromAllDrives")).toBe("true");
      return Response.json({ files: folders[parent] ?? [] });
    }
    if (url.hostname === "www.googleapis.com" && path.endsWith("/export")) {
      if (url.searchParams.get("mimeType") === "application/pdf") {
        return new Response(PDF, { headers: { "content-type": "application/pdf" } });
      }
      return new Response(`slides of ${path.split("/")[4]}`);
    }
    if (url.hostname === "www.googleapis.com" && path.startsWith("/drive/v3/files/")) {
      return Response.json(metadata);
    }
    if (url.hostname === "docs.googleapis.com") {
      return Response.json(docJson(`body of ${path.split("/").pop()}`));
    }
    if (url.hostname === "sheets.googleapis.com" && path.endsWith("values:batchGet")) {
      return Response.json({ valueRanges: [{ values: [["a"], ["1"]] }] });
    }
    if (url.hostname === "sheets.googleapis.com") {
      return Response.json({
        sheets: [{ properties: { sheetId: 0, title: "Q1", index: 0, sheetType: "GRID" } }],
      });
    }
    if (url.hostname === "docs.google.com" && path.endsWith("/export")) {
      return new Response(PDF, { headers: { "content-type": "application/pdf" } });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

function fakeBucket() {
  const objects = new Map<string, Uint8Array | string>();
  return {
    objects,
    put: vi.fn(async (key: string, body: Uint8Array | string) => {
      objects.set(key, body);
    }),
    get: vi.fn(async (key: string) => {
      const body = objects.get(key);
      if (body === undefined) return null;
      const text = typeof body === "string" ? body : new TextDecoder().decode(body);
      return {
        text: async () => text,
        json: async () => JSON.parse(text),
        arrayBuffer: async () => new TextEncoder().encode(text).buffer,
      };
    }),
    delete: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
    }),
  };
}

async function runImport(sourceId: string, bucket: ReturnType<typeof fakeBucket>) {
  const source = sqlite.prepare("SELECT * FROM sources WHERE id = ?").get(sourceId) as {
    status: string;
    fetch_attempt_id: string | null;
  };
  const start = (request: SourceImportClaimRequest) =>
    claimSourceImport({} as Env, request).then(Boolean);
  await startSourceImport(
    { SOURCE_IMPORT_DO: { getByName: () => ({ start }) } } as unknown as Env,
    {
      id: sourceId,
      status: source.status,
      fetchAttemptId: source.fetch_attempt_id,
    } as never,
    `attempt-${Math.random()}`,
  );
  const run = sqlite
    .prepare("SELECT id FROM source_import_runs WHERE source_id = ?")
    .get(sourceId) as { id: string };
  const sql = memorySql();
  for (let tick = 0; tick < 50; tick += 1) {
    const result = await advanceSourceImportTick({
      env: { BUCKET: bucket } as unknown as Env,
      sql,
      budget: new SubrequestBudget(40),
      runId: run.id,
    });
    if (result.finished) return;
  }
  throw new Error("import did not finish");
}

function documents(sourceId: string) {
  return sqlite
    .prepare("SELECT path, status FROM source_documents WHERE source_id = ? ORDER BY path")
    .all(sourceId) as Array<{ path: string; status: string }>;
}

function insertSource(id: string, kind: string, externalId: string, url: string) {
  sqlite
    .prepare(
      `INSERT INTO sources (id, kind, url, external_id, title, added_by, status)
       VALUES (?, ?, ?, ?, 'Provisional', 'user-1', 'pending')`,
    )
    .run(id, kind, url, externalId);
}

beforeEach(() => {
  vi.restoreAllMocks();
  sqlite.exec("DELETE FROM source_import_runs; DELETE FROM source_documents; DELETE FROM sources;");
});

describe("Google Drive folder source", () => {
  const tree: Record<string, Item[]> = {
    root: [
      { id: "sub-1", name: "Sub", mimeType: FOLDER },
      { id: "doc-1", name: "Minutes", mimeType: DOC },
      { id: "doc-2", name: "Minutes", mimeType: DOC },
      { id: "scan", name: "Scan.pdf", mimeType: "application/pdf" },
      {
        id: "short-1",
        name: "Deck",
        mimeType: "application/vnd.google-apps.shortcut",
        shortcutDetails: { targetId: "deck-1", targetMimeType: SLIDES },
      },
      {
        id: "short-2",
        name: "Loop",
        mimeType: "application/vnd.google-apps.shortcut",
        shortcutDetails: { targetId: "root", targetMimeType: FOLDER },
      },
    ],
    "sub-1": [
      { id: "sheet-1", name: "Budget/2026", mimeType: SHEET },
      { id: "doc-1", name: "Minutes", mimeType: DOC },
    ],
  };

  it("imports every file beneath the folder under the folder's own paths", async () => {
    insertSource(
      "folder",
      "google-drive-folder",
      "root",
      "https://drive.google.com/drive/folders/root",
    );
    stubGoogle(tree, { name: "Root", mimeType: FOLDER });
    const bucket = fakeBucket();

    await runImport("folder", bucket);

    expect(documents("folder")).toEqual([
      { path: "Deck/index.md", status: "ready" },
      { path: "Deck/index.pdf", status: "ready" },
      { path: "Minutes (2)/index.md", status: "ready" },
      { path: "Minutes/index.md", status: "ready" },
      { path: "Sub/Budget／2026/Q1.md", status: "ready" },
      { path: "Sub/Budget／2026/Q1.pdf", status: "ready" },
    ]);
    expect(sqlite.prepare("SELECT title, kind, status FROM sources").get()).toEqual({
      title: "Root",
      kind: "google-drive-folder",
      status: "ready",
    });
    const minutes = [...bucket.objects.entries()].find(([key]) =>
      key.endsWith("/raw/folder/Minutes (2)/index.md"),
    );
    expect(String(minutes?.[1] && new TextDecoder().decode(minutes[1] as Uint8Array))).toContain(
      "body of doc-2",
    );
    // Staging objects of the run are cleaned up; only raw documents remain.
    expect([...bucket.objects.keys()].filter((key) => key.includes("/import-runs/"))).toEqual([]);
  });

  it("archives a file that left the folder on the next refresh", async () => {
    insertSource(
      "folder",
      "google-drive-folder",
      "root",
      "https://drive.google.com/drive/folders/root",
    );
    stubGoogle(tree, { name: "Root", mimeType: FOLDER });
    const bucket = fakeBucket();
    await runImport("folder", bucket);

    vi.restoreAllMocks();
    stubGoogle(
      { ...tree, root: tree.root?.filter((item) => item.id !== "short-1") ?? [] },
      { name: "Root", mimeType: FOLDER },
    );
    await runImport("folder", bucket);

    expect(documents("folder").filter((doc) => doc.path.startsWith("Deck/"))).toEqual([
      { path: "Deck/index.md", status: "archived" },
      { path: "Deck/index.pdf", status: "archived" },
    ]);
  });

  it("still imports a single Doc source at the source root", async () => {
    insertSource("doc", "google-doc", "doc-9", "https://docs.google.com/document/d/doc-9/edit");
    stubGoogle({}, { name: "Solo", mimeType: DOC });

    await runImport("doc", fakeBucket());

    expect(documents("doc")).toEqual([{ path: "index.md", status: "ready" }]);
  });
});
