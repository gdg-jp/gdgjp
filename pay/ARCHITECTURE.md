# Pay architecture

`app/routes/` owns React Router endpoints and composed page rendering.
Small loaders/actions compose feature functions directly; the claim detail endpoint
delegates its receipt, synchronization, and email workflows to
`features/claims/detail.server.ts`.

Features own their implementation, types, and tests:

- `auth/`: Accounts relying-party setup, session/membership retrieval, safe redirects.
- `events/`: event persistence and chapter/owner permission policy.
- `profiles/`: claimant identity and encrypted bank account persistence.
- `claims/`: claim/item persistence, yen arithmetic, authenticated detail workflows,
  and the explicit review-email operation.
- `receipts/`: file constraints, object keys, and Gemini extraction.
- `google/`: OAuth transactions/token lifecycle, Drive access, Sheets sync/template
  values, and connection/Picker UI.

Repositories own SQL for their domain. `types.ts` modules contain browser-safe
data shapes; consumers import them without importing a server repository.
Claims orchestrate receipts, Google sync, and profile bank data; those adapters
do not import claim workflows. Event Google configuration remains in the event
repository, while OAuth credentials and transactions belong to Google.

`app/lib/` contains only shared, domain-independent ID, encryption, theme, and
class-name utilities. Frontend composition has three explicit categories:

- `app/components/`: domain-free UI primitives and small shared controls.
- `app/features/<domain>/components/`: domain widgets, including claim items,
  receipt uploads, and Google connection/Picker controls.
- `app/routes/<domain>/`: registered route modules containing metadata,
  loader/action adapters, and the full screen composed from widgets and shared UI.
  `app/layouts/` contains the shared composed header/shell.

Screens use their route's generated component props; features never import route
modules or generated route types. Domain workflows remain in features, while
React Router strips server-only loader/action dependencies from production client builds.

Import concrete modules directly; do not add umbrella exports or move business
logic back into `lib/`. Network, D1, and encryption operations use `.server.ts`.

Refactors must preserve ownership/chapter checks, receipt-to-item checks, bank
and token encryption, silent Drive sharing, and email being sent only through
the explicit send-email action. Migrations, bindings, route URLs, and external
integration contracts are unchanged by this organization.
