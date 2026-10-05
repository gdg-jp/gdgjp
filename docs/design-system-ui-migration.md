# Design-system application migration

Verification date: 2026-10-05. Scope: Accounts, Img, Pay, Scheduler, and TinyURL.

## Changes

| App | Main changes | Unit tests |
| --- | --- | ---: |
| Accounts | Shared search, filters, checkbox selection, empty states, persistent errors, responsive chapter rows, table headers | 201 |
| Img | Shared forms, menus, cards, empty/loading states, deletion dialogs, responsive gallery/detail screens | 85 |
| Pay | Shared forms and theme, unique repeated-field IDs, responsive tables, account/app menus, persistent feedback | 28 |
| Scheduler | Shared forms and native selects, menus, deletion confirmation, responsive event actions, independent response-delete form | 43 |
| TinyURL | Shared shell/sidebar, theme, menus, dialogs, comboboxes, calendars, forms, analytics tabs, feedback | 279 |

Img, Pay, Scheduler, and TinyURL remove their local `app/components/ui/` directories,
redundant theme/class helpers, and dependencies used only by those primitives. All five apps
consume the public `@gdgjp/design-system` API and shipped CSS. Product-specific data, routing,
authorization, and mutations remain app-owned. The design-system submodule is unchanged.

CI now propagates shared-library changes to all seven consumers (these five, Wiki, and Roster).
Pay's new Playwright suite is selected by hosted CI, full local CI, and staged frontend/harness
changes. The lockfile reflects the workspace dependencies.

## Validation and limits

- All five focused unit suites passed: 636 tests in total.
- Each app's typecheck and production build passed during implementation.
- Shared-library build and `test:consumer` passed, including SSR, nonce, fonts, and browser build.
- The full workspace test graph passed with sequential execution: 21 tasks, including cached tasks.
- CI selection tests passed: 37 tests.
- Final repository-wide lint, typecheck, and UI-convention checks passed. The separate
  `ci:quick` run stopped at its script-test stage on the agent-host assertion below; its
  subsequent build stage and `ci:full` were not completed.
- Existing browser suites passed: Accounts 2, Img 2, Scheduler 4, TinyURL 2.
- Pay's new fixture browser suite passed 5 tests, including cold server startup/teardown.
- Browser inspection used real screen components in light/dark at 390px and 1280px.
  Accounts covered chapter search/filter and user selection; Img covered its three screens;
  Pay covered seven screens; Scheduler covered create/list/edit/participation; TinyURL covered
  six representative screens. Keyboard, focus restoration, long text, and overflow were checked.
- Authenticated-screen inspection used fixture loader/action data. It does not prove real
  authenticated mutations, receipt extraction, Google integrations, publishing, or Cloudflare
  delivery. TinyURL's anonymous redirect tests exercised the local OIDC path.
- The repository-level test command failed on the unchanged agent-host layout assertion
  `unverifiable skills-lock.json in root must be removed` in
  `.github/scripts/gdg-agent-layout.test.mjs`. This is separate from the passing workspace suites.

## Shared-library findings

These findings were inspected in the checked-out library, not inferred from migration history.
No copied interaction primitives, private DOM overrides, or library edits were added.

| Source | Expected behavior / limitation | Application decision and validity after a library fix |
| --- | --- | --- |
| `src/components/Icons/Icons.tsx:142` | Static icons render a `div`; animated icons also use a `div` wrapper. Icons intended for inline text/buttons should provide phrasing content. Inside a paragraph, the wrapper changes the SSR parse tree. | Compose icons beside text/headings with `Inline`; retain the recommended public button/icon API. The sibling composition remains valid after a phrasing-safe library fix. Per-call private DOM replacement was avoided. |
| `src/components/AppShell/AppShell.tsx:66`, `src/styles/components.css:2767` | Offcanvas desktop collapse hides the sidebar's own reopen trigger. A reachable desktop control must remain outside the hidden pane. | TinyURL uses the supported icon-collapse mode and named navigation links. This composition remains valid after an offcanvas fix; no duplicate app-owned collapse control was introduced. |
| `src/components/ToggleGroup/ToggleGroup.tsx:5` | Single selection exposes radio items within a generic group; the root should expose `radiogroup`. | Accounts supplies the public `role="radiogroup"` prop. It remains a valid explicit role after correcting the shared default. |
| `src/components/Icons/Icons.tsx:1,76` | Dynamic namespace icon lookup limits per-icon tree shaking. Shared client chunks measured about 879–884 kB before gzip in Scheduler/Img builds; this is total shared-chunk size, not an icon-only measurement. | Keep shared icons and report the bundle cost. The library can provide statically prunable exports without introducing app-local icon facades. |

The library's `DESIGN.md` already documents the primary white-on-blue contrast limitation
(about 3.56:1). Its normal-size button text is below the skill's 4.5:1 text criterion. No
app-specific primary-token override was added; small domain status/selection labels use semantic
link, selected, success, warning, and danger tokens where appropriate.

The public icon catalog and Popover exports do not exactly match the removed local library.
Suitable existing icons were selected; transient clipboard success uses shared toast feedback.
Neither limitation requires a copied app-side primitive.

## Change inventory

`M`: modified, `A`: added, `D`: deleted. This is the task working-tree snapshot; no commit was made.

- `M` `.github/scripts/changed-workspaces.mjs`
- `M` `.github/scripts/changed-workspaces.test.mjs`
- `M` `.github/scripts/gdg-ui-ci.test.mjs`
- `M` `accounts/app/app.css`
- `M` `accounts/app/features/chapters/components/chapter-row.tsx`
- `M` `accounts/app/features/onboarding/components/chapter-step.tsx`
- `M` `accounts/app/features/users/components/user-actions.tsx`
- `M` `accounts/app/layouts/page-shell.tsx`
- `M` `accounts/app/layouts/top-bar.tsx`
- `M` `accounts/app/routes/chapters/admin.chapters.tsx`
- `M` `accounts/app/routes/chapters/chapters.tsx`
- `M` `accounts/app/routes/developer-apps/developers.apps.tsx`
- `M` `accounts/app/routes/google-workspace/settings.google-workspace.tsx`
- `M` `accounts/app/routes/memberships/admin.requests.tsx`
- `M` `accounts/app/routes/memberships/chapters.$slug.organize.tsx`
- `M` `accounts/app/routes/users/admin.users.tsx`
- `A` `docs/design-system-ui-migration.md`
- `M` `img/app/app.css`
- `M` `img/app/architecture.test.ts`
- `D` `img/app/components/ui/button.tsx`
- `D` `img/app/components/ui/card.tsx`
- `D` `img/app/components/ui/input.tsx`
- `D` `img/app/components/ui/label.tsx`
- `D` `img/app/components/ui/select.tsx`
- `M` `img/app/features/folders/components/folder-bar.tsx`
- `M` `img/app/features/images/components/chapter-card.tsx`
- `M` `img/app/features/images/components/folder-card.tsx`
- `M` `img/app/features/images/components/gallery-grid.tsx`
- `M` `img/app/features/images/components/mobile-card.tsx`
- `M` `img/app/features/images/components/replace-card.tsx`
- `M` `img/app/features/images/components/slug-card.tsx`
- `M` `img/app/features/images/components/upload-form.tsx`
- `M` `img/app/features/images/components/url-builder-card.tsx`
- `M` `img/app/layouts/page-shell.tsx`
- `M` `img/app/layouts/top-bar.tsx`
- `D` `img/app/lib/utils.ts`
- `M` `img/app/root.tsx`
- `M` `img/app/routes/auth/no-chapter.tsx`
- `M` `img/app/routes/images/detail.tsx`
- `M` `img/app/routes/images/gallery.tsx`
- `M` `img/ARCHITECTURE.md`
- `M` `img/package.json`
- `M` `pay/app/app.css`
- `M` `pay/app/components/gdg-mark.tsx`
- `D` `pay/app/components/theme-toggle.tsx`
- `D` `pay/app/components/ui/button.tsx`
- `D` `pay/app/components/ui/card.tsx`
- `D` `pay/app/components/ui/dropdown-menu.tsx`
- `D` `pay/app/components/ui/input.tsx`
- `D` `pay/app/components/ui/label.tsx`
- `D` `pay/app/components/ui/sonner.tsx`
- `D` `pay/app/components/ui/table.tsx`
- `D` `pay/app/components/ui/textarea.tsx`
- `M` `pay/app/features/claims/components/claim-items.tsx`
- `M` `pay/app/features/claims/components/receipt-upload.tsx`
- `M` `pay/app/features/google/components/google-connection-card.tsx`
- `M` `pay/app/features/google/components/google-drive-picker.tsx`
- `M` `pay/app/layouts/header.tsx`
- `D` `pay/app/lib/theme.tsx`
- `D` `pay/app/lib/utils.ts`
- `M` `pay/app/root.tsx`
- `M` `pay/app/routes/claims/claim-detail.tsx`
- `M` `pay/app/routes/claims/new-claim.tsx`
- `M` `pay/app/routes/claims/proxy-claim.tsx`
- `M` `pay/app/routes/events/event-detail.tsx`
- `M` `pay/app/routes/events/event-list.tsx`
- `M` `pay/app/routes/events/new-event.tsx`
- `M` `pay/app/routes/profiles/profile.tsx`
- `A` `pay/e2e/ui-harness.tsx`
- `A` `pay/e2e/ui.spec.ts`
- `M` `pay/package.json`
- `A` `pay/playwright.config.ts`
- `M` `pay/vite.config.ts`
- `M` `pnpm-lock.yaml`
- `M` `scheduler/app/app.css`
- `M` `scheduler/app/architecture.test.ts`
- `M` `scheduler/app/components/gdg-mark.tsx`
- `M` `scheduler/app/components/share-url.tsx`
- `D` `scheduler/app/components/theme-toggle.tsx`
- `D` `scheduler/app/components/ui/button.tsx`
- `D` `scheduler/app/components/ui/card.tsx`
- `D` `scheduler/app/components/ui/dropdown-menu.tsx`
- `D` `scheduler/app/components/ui/input.tsx`
- `D` `scheduler/app/components/ui/label.tsx`
- `D` `scheduler/app/components/ui/sonner.tsx`
- `D` `scheduler/app/components/ui/table.tsx`
- `D` `scheduler/app/components/ui/textarea.tsx`
- `M` `scheduler/app/features/scheduling/components/schedule-editor.tsx`
- `M` `scheduler/app/features/scheduling/components/slot-pill-grid.tsx`
- `M` `scheduler/app/layouts/header.tsx`
- `D` `scheduler/app/lib/theme.tsx`
- `D` `scheduler/app/lib/utils.ts`
- `M` `scheduler/app/root.tsx`
- `M` `scheduler/app/routes/events/create.tsx`
- `M` `scheduler/app/routes/events/edit.tsx`
- `M` `scheduler/app/routes/events/list.tsx`
- `M` `scheduler/app/routes/participants/event.tsx`
- `M` `scheduler/ARCHITECTURE.md`
- `M` `scheduler/e2e/home.spec.ts`
- `M` `scheduler/package.json`
- `M` `scripts/run-ci.mjs`
- `M` `tinyurl/app/app.css`
- `M` `tinyurl/app/components/gdg-mark.tsx`
- `M` `tinyurl/app/components/status-badge.tsx`
- `D` `tinyurl/app/components/ui/alert-dialog.tsx`
- `D` `tinyurl/app/components/ui/alert.tsx`
- `D` `tinyurl/app/components/ui/avatar.tsx`
- `D` `tinyurl/app/components/ui/badge.tsx`
- `D` `tinyurl/app/components/ui/button.tsx`
- `D` `tinyurl/app/components/ui/calendar.tsx`
- `D` `tinyurl/app/components/ui/card.tsx`
- `D` `tinyurl/app/components/ui/dialog.tsx`
- `D` `tinyurl/app/components/ui/dropdown-menu.tsx`
- `D` `tinyurl/app/components/ui/field-label.tsx`
- `D` `tinyurl/app/components/ui/input.tsx`
- `D` `tinyurl/app/components/ui/label.tsx`
- `D` `tinyurl/app/components/ui/motion.tsx`
- `D` `tinyurl/app/components/ui/popover.tsx`
- `D` `tinyurl/app/components/ui/select.tsx`
- `D` `tinyurl/app/components/ui/separator.tsx`
- `D` `tinyurl/app/components/ui/sheet.tsx`
- `D` `tinyurl/app/components/ui/skeleton.tsx`
- `D` `tinyurl/app/components/ui/sonner.tsx`
- `D` `tinyurl/app/components/ui/spinner.tsx`
- `D` `tinyurl/app/components/ui/submit-button.tsx`
- `D` `tinyurl/app/components/ui/table.tsx`
- `D` `tinyurl/app/components/ui/textarea.tsx`
- `M` `tinyurl/app/features/analytics/components/analytics/analytics-automated-clicks-toggle.tsx`
- `M` `tinyurl/app/features/analytics/components/analytics/analytics-breakdown-cards.tsx`
- `M` `tinyurl/app/features/analytics/components/analytics/analytics-date-button.tsx`
- `M` `tinyurl/app/features/analytics/components/analytics/analytics-filter-button.tsx`
- `M` `tinyurl/app/features/analytics/components/analytics/analytics-filters-bar.tsx`
- `M` `tinyurl/app/features/analytics/components/analytics/analytics-graph-interval.tsx`
- `M` `tinyurl/app/features/analytics/components/charts/analytics-area-chart.tsx`
- `M` `tinyurl/app/features/analytics/components/charts/analytics-trend-chart.tsx`
- `M` `tinyurl/app/features/analytics/components/charts/bar-list.tsx`
- `M` `tinyurl/app/features/analytics/components/charts/hourly-chart.tsx`
- `M` `tinyurl/app/features/analytics/components/charts/metric-card.tsx`
- `M` `tinyurl/app/features/analytics/components/charts/tabbed-bar-card.tsx`
- `M` `tinyurl/app/features/analytics/components/overview.tsx`
- `A` `tinyurl/app/features/analytics/date-format.ts`
- `M` `tinyurl/app/features/campaigns/components/acquisition-analytics.tsx`
- `M` `tinyurl/app/features/campaigns/components/campaign-dialog.tsx`
- `M` `tinyurl/app/features/campaigns/components/campaign-list.tsx`
- `M` `tinyurl/app/features/campaigns/components/channel-card.tsx`
- `M` `tinyurl/app/features/campaigns/components/channel-dialogs.tsx`
- `M` `tinyurl/app/features/campaigns/components/chapter-access-select.tsx`
- `M` `tinyurl/app/features/campaigns/components/detail-analytics.tsx`
- `M` `tinyurl/app/features/campaigns/components/participant-file-dialog.tsx`
- `M` `tinyurl/app/features/campaigns/components/participant-import-wizard.tsx`
- `M` `tinyurl/app/features/campaigns/components/source-combobox.tsx`
- `M` `tinyurl/app/features/dashboard/components/display-menu.tsx`
- `M` `tinyurl/app/features/dashboard/components/results.tsx`
- `M` `tinyurl/app/features/domains/components/connect-domain-dialog.tsx`
- `M` `tinyurl/app/features/domains/components/domain-card.tsx`
- `M` `tinyurl/app/features/folders/components/folder-detail.tsx`
- `M` `tinyurl/app/features/folders/components/folder-list.tsx`
- `M` `tinyurl/app/features/links/components/create-link-dialog.tsx`
- `M` `tinyurl/app/features/links/components/edit-fields.tsx`
- `M` `tinyurl/app/features/links/components/link-action-dialog.tsx`
- `M` `tinyurl/app/features/links/components/link-card.tsx`
- `M` `tinyurl/app/features/links/components/link-list.tsx`
- `M` `tinyurl/app/features/tags/components/tag-combobox.tsx`
- `M` `tinyurl/app/features/tags/components/tag-list.tsx`
- `D` `tinyurl/app/layouts/dashboard-page.tsx`
- `M` `tinyurl/app/layouts/dashboard-shell.tsx`
- `M` `tinyurl/app/layouts/page-shell.tsx`
- `M` `tinyurl/app/layouts/top-bar.tsx`
- `M` `tinyurl/app/layouts/user-menu.tsx`
- `D` `tinyurl/app/lib/utils.ts`
- `M` `tinyurl/app/root.tsx`
- `M` `tinyurl/app/routes/analytics/analytics.tsx`
- `M` `tinyurl/app/routes/auth/no-chapter.tsx`
- `M` `tinyurl/app/routes/campaigns/campaigns.$id.tsx`
- `M` `tinyurl/app/routes/campaigns/campaigns.tsx`
- `M` `tinyurl/app/routes/dashboard/dashboard.tsx`
- `M` `tinyurl/app/routes/domains/domains.tsx`
- `M` `tinyurl/app/routes/folders/folders.$id.tsx`
- `M` `tinyurl/app/routes/folders/folders.tsx`
- `M` `tinyurl/app/routes/links/links.$id.tsx`
- `M` `tinyurl/app/routes/public/notfound.tsx`
- `M` `tinyurl/app/routes/tags/tags.tsx`
- `M` `tinyurl/ARCHITECTURE.md`
- `M` `tinyurl/package.json`
- `M` `tinyurl/tests/architecture/layering.test.ts`
