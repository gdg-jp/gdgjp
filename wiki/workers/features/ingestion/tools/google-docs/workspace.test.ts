import { describe, expect, it } from "vitest";
import type { GoogleDocsDocument } from "../../../../../app/lib/google-drive.server";
import {
  createGoogleDocsWorkspaceAdapter,
  flattenGoogleDocsWorkspaceNodes,
  googleDocsPathSegment,
} from "./workspace";

function documentFixture(): GoogleDocsDocument {
  return {
    documentId: "meeting-minutes",
    title: "Build with AI Meeting Minutes",
    tabs: [
      {
        tabProperties: { tabId: "planning", title: "Planning" },
        documentTab: {
          body: {
            content: [{ paragraph: { elements: [{ textRun: { content: "Planning notes\n" } }] } }],
          },
        },
        childTabs: [
          {
            tabProperties: { tabId: "pr", title: "PR" },
            documentTab: {
              body: {
                content: [{ paragraph: { elements: [{ textRun: { content: "PR notes\n" } }] } }],
              },
            },
            childTabs: [
              {
                tabProperties: { tabId: "publicity", title: "広報_議事録" },
                documentTab: {
                  body: {
                    content: [
                      {
                        paragraph: {
                          elements: [{ textRun: { content: "公開用の議事録\n" } }],
                        },
                      },
                    ],
                  },
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("Google Docs workspace adapter", () => {
  it("keeps nested tabs as readable nodes without concatenating their bodies", async () => {
    const workspace = createGoogleDocsWorkspaceAdapter([{ document: documentFixture() }]);

    expect((await workspace.ls("")).data).toMatchObject({
      entries: [
        {
          name: "Build with AI Meeting Minutes",
          path: "Build with AI Meeting Minutes",
          readable: false,
          hasChildren: true,
        },
      ],
    });
    expect(
      (await workspace.ls("Build with AI Meeting Minutes")).data.entries.map((entry) => entry.name),
    ).toEqual(["Planning"]);
    expect(
      (await workspace.ls("Build with AI Meeting Minutes/Planning")).data.entries[0],
    ).toMatchObject({
      name: "PR",
      readable: true,
      hasChildren: true,
    });

    const tab = await workspace.cat("Build with AI Meeting Minutes/Planning/PR/広報_議事録");
    expect(tab.data.content).toBe("公開用の議事録\n");
    expect(tab.data.nextCursor).toBeNull();
    await expect(workspace.cat("Build with AI Meeting Minutes/Planning/PR")).resolves.toMatchObject(
      {
        data: { content: "PR notes\n" },
      },
    );
  });

  it("makes duplicate titles addressable and replaces path separators without extensions", async () => {
    const duplicateTitle = documentFixture();
    duplicateTitle.tabs = [
      {
        tabProperties: { tabId: "first", title: "同じ/タブ" },
        documentTab: { body: { content: [] } },
      },
      {
        tabProperties: { tabId: "second", title: "同じ/タブ" },
        documentTab: {
          body: {
            content: [{ paragraph: { elements: [{ textRun: { content: "second" } }] } }],
          },
        },
      },
    ];
    const workspace = createGoogleDocsWorkspaceAdapter([{ document: duplicateTitle }]);
    const path = "Build with AI Meeting Minutes";

    expect((await workspace.ls(path)).data.entries.map((entry) => entry.name)).toEqual([
      "同じ／タブ",
      "同じ／タブ (2)",
    ]);
    expect((await workspace.cat(`${path}/同じ／タブ (2)`)).data.content).toBe("second");
    expect(googleDocsPathSegment("Agenda/PR", "Tab")).toBe("Agenda／PR");
  });

  it("retains the legacy single-document body on the document node", async () => {
    const workspace = createGoogleDocsWorkspaceAdapter([
      {
        document: {
          documentId: "legacy",
          title: "Legacy Doc",
          body: { content: [{ paragraph: { elements: [{ textRun: { content: "legacy" } }] } }] },
        },
      },
    ]);

    await expect(workspace.cat("Legacy Doc")).resolves.toMatchObject({
      data: { content: "legacy" },
    });
  });

  it("flattens document and nested tab bodies into separately persistable nodes", () => {
    expect(flattenGoogleDocsWorkspaceNodes([{ document: documentFixture() }])).toEqual([
      {
        path: "Build with AI Meeting Minutes",
        parentPath: null,
        title: "Build with AI Meeting Minutes",
        kind: "google_document",
        externalId: "meeting-minutes",
      },
      {
        path: "Build with AI Meeting Minutes/Planning",
        parentPath: "Build with AI Meeting Minutes",
        title: "Planning",
        kind: "google_tab",
        content: "Planning notes\n",
        externalId: "planning",
      },
      {
        path: "Build with AI Meeting Minutes/Planning/PR",
        parentPath: "Build with AI Meeting Minutes/Planning",
        title: "PR",
        kind: "google_tab",
        content: "PR notes\n",
        externalId: "pr",
      },
      {
        path: "Build with AI Meeting Minutes/Planning/PR/広報_議事録",
        parentPath: "Build with AI Meeting Minutes/Planning/PR",
        title: "広報_議事録",
        kind: "google_tab",
        content: "公開用の議事録\n",
        externalId: "publicity",
      },
    ]);
  });
});
