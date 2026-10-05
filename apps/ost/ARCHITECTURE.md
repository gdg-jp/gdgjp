# OST architecture

- `app/routes/` adapts React Router loader/action arguments, response headers and metadata.
  Registered modules in `app/routes/{auth,events,board,layout}/` own both the HTTP adapter
  and the composed screen. Routes call concrete feature modules.
- `features/auth/` owns relying-party sessions, sign-in redirects and chapter membership.
  It does not depend on event or board features.
- `features/events/` owns the D1 event registry, slug rules, event creation and chapter-owner
  authorization. `event.ts` is a neutral record shape; `*.server.ts` owns storage and policy.
- `features/board/` owns the neutral snapshot/WebSocket protocol, topic validation,
  scoring/assignment rules, public participation and moderator use cases. The live hook and
  participant/projector pages consume that protocol; voter identity stays server-only.
- `features/layout/` owns desk geometry, layout management and desk editor/assignment views.
  `DeskNode` handles a single desk gesture; the editor owns shared gesture/viewport state.
- `app/components/` holds domain-free motion primitives/presets.
- `app/layouts/` holds the composed application header/account shell.
- Each feature owns `components/` for domain widgets. Composed screens belong to
  the registered route module, composing feature widgets, shared layouts and primitive components.
- `workers/` owns the Worker adapter and `OstBoard` SQLite/hibernatable WebSocket runtime.
  Worker code imports neutral domain modules, never server features or React views.

Features do not import routes. Route modules use server features only from loader/action exports;
React Router strips those imports from the production client build. Widgets do not import server modules.
Feature imports are direct;
there are no compatibility barrels. Unit tests live beside their domain modules, and
`app/architecture.test.ts` guards these dependency boundaries.

The Durable Object class/export name, per-slug identity, SQL schema, full-state message shape,
RPC methods and public/admin authorization semantics are unchanged. E2E tests exercise the
routes against the real local Worker runtime.
