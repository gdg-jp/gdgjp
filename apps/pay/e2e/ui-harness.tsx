// Browser-only fixture data. Real route components; authentication and mutations are not exercised.
import { ThemeProvider } from "@gdgjp/design-system";
import type { ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createMemoryRouter } from "react-router";
import ClaimDetailPage from "../app/routes/claims/claim-detail";
import NewClaimPage from "../app/routes/claims/new-claim";
import ProxyClaimPage from "../app/routes/claims/proxy-claim";
import EventDetailPage from "../app/routes/events/event-detail";
import HomePage from "../app/routes/events/event-list";
import NewEventPage from "../app/routes/events/new-event";
import ProfilePage from "../app/routes/profiles/profile";
import "../app/app.css";

const user = { id: "fixture-user", name: "山田 太郎", email: "fixture@example.test", image: null };
const event = {
  id: "evt_fixture",
  title: "日本語の長いイベント名・コミュニティ経費精算とイベント運営の確認会",
};
const google = {
  adminUserId: null,
  adminEmail: null,
  isCurrentUserAdmin: false,
  templateGranted: false,
  folderId: null,
  folderName: null,
  pickerAppId: "",
  pickerApiKey: "",
  templateSpreadsheetId: "fixture",
};
const items = [1, 2].map((index) => ({
  id: `item-${index}`,
  spentOn: "2026-10-05",
  category: "飲食",
  description: "参加者向けの食事・コミュニティ交流用",
  amountYen: 1200,
  receiptFilename: "領収書.pdf",
  receiptKey: null,
}));

export function renderScreen(screen: string, state: string, theme: "light" | "dark") {
  const error = state === "error" ? { error: "入力内容を確認してください" } : undefined;
  const screens = {
    home: [
      HomePage,
      {
        user: state === "signed-out" ? null : user,
        events: state === "empty" ? [] : [{ ...event, total: 2400, claimCount: 2, createdAt: 0 }],
      },
    ],
    event: [
      EventDetailPage,
      {
        user,
        event,
        canManage: true,
        canProxy: true,
        hasProfile: state !== "warning",
        selfClaimId: null,
        total: 2400,
        google,
        claims:
          state === "empty"
            ? []
            : [
                {
                  id: "claim-fixture",
                  kind: "self",
                  applicantName: user.name,
                  totalAmount: 2400,
                  status: "synced",
                  sheetUrl: null,
                  emailSentAt: null,
                },
              ],
      },
    ],
    "new-event": [
      NewEventPage,
      { user, chapters: [{ slug: "tokyo", id: "chapter", role: "organizer" }] },
    ],
    profile: [ProfilePage, { user, profile: null }],
    "new-claim": [NewClaimPage, { user, event }],
    proxy: [ProxyClaimPage, { user, event }],
    claim: [
      ClaimDetailPage,
      {
        user,
        event,
        canEdit: state !== "readonly",
        items: state === "empty" ? [] : items,
        categories: ["飲食", "会場"],
        claim: {
          applicantName: user.name,
          applicationDate: "2026-10-05",
          kind: "self",
          totalAmount: 2400,
          sheetUrl: null,
          emailSentAt: null,
        },
      },
    ],
  } as const;
  const [Screen, loaderData] = screens[screen as keyof typeof screens];
  const host = document.createElement("div");
  document.body.replaceChildren(host);
  const router = createMemoryRouter(
    [{ id: "fixture", path: "*", Component: Screen as ComponentType, loader: () => loaderData }],
    {
      hydrationData: {
        loaderData: { fixture: loaderData },
        actionData: error ? { fixture: error } : undefined,
      },
    },
  );
  createRoot(host).render(
    <ThemeProvider forcedTheme={theme}>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
}
