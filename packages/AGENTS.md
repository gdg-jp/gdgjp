# Shared packages

- `gdg-lib/` is the source-only `@gdgjp/gdg-lib` package for shared relying-party auth
  and signed-cookie helpers. Read its local `AGENTS.md`; keep app-specific code in apps.
- `design-system/` is the `gdg-jp/design-system` Git submodule and React 19 workspace
  (`@gdgjp/design-system`). Read its own instructions and `DESIGN.md` → `Harness`.
  Keep it independent of application routing, authentication, and data fetching.
  Contracts live in `design/`; run its `pnpm --filter @gdgjp/design-system design:*`
  checks from the repository root.
