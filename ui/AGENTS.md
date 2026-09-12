# UI Library Guidelines

## Scope and Sources of Truth

This directory is the private `@gdgjp/ui` React 19 design-system workspace. It must remain
independent of application routing, authentication, data fetching, and product-specific business
logic. Follow the repository-level guide as well as this file.

Read `DESIGN.md` before changing visual language, motion, accessibility behavior, tokens, or the
public API. Treat `src/styles/tokens.css` as the only hand-edited token source. `README.md` documents
the consumer contract and must stay synchronized with user-visible API or integration changes.

## Component and Styling Conventions

- Put each component in `src/components/<Name>/` with its implementation, Storybook story, local
  tests when appropriate, and an `index.ts` export. Add public components to
  `src/components/index.ts`; expose only intended package APIs through `src/index.ts`.
- Preserve native element props and refs. For Radix-based controls, preserve controlled and
  uncontrolled behavior, events, focus restoration, keyboard interaction, and ARIA semantics.
  Do not reimplement Radix interaction primitives or add Base UI alongside them.
- Components use stable `gdg-*` classes and shipped CSS; they must not depend on a consumer's
  Tailwind source scan. Keep the named layer order `gdg-tokens`, `gdg-base`, `gdg-components`, then
  consumer `utilities`.
- Use semantic tokens instead of literal theme colors. Validate both light and dark themes,
  forced-colors, reduced motion, long Japanese content, and narrow layouts.
- Follow the motion timings and easing in `DESIGN.md`. Do not use `transition: all`, `scale(0)`,
  or decorative motion for keyboard actions.

## Stories, Tests, and Generated Output

Every component behavior or appearance change needs representative stories. Cover meaningful
states and composition, not only an isolated happy path. Add Vitest coverage for public API, SSR,
and deterministic behavior; use Playwright for browser interaction, accessibility, and visual
regressions. Inspect changed snapshots before accepting them and explain intentional visual changes
in the PR.

Run focused checks from the repository root:

```sh
pnpm --filter @gdgjp/ui typecheck
pnpm --filter @gdgjp/ui test
pnpm --filter @gdgjp/ui test:consumer
pnpm --filter @gdgjp/ui test:e2e
```

Run `test:consumer` after changing exports, build scripts, CSS entry points, fonts, or package
metadata. Do not commit `dist/`, Storybook build output, Playwright reports, or other generated
artifacts. The PNG files under `e2e/library.spec.ts-snapshots/` are reviewed test fixtures and are
committed only when the visual contract intentionally changes.

## Public Contract Changes

Exports, props, CSS variables, semantic Tailwind utilities, and theme behavior are public
contracts. Prefer composition of existing components before adding an overlapping primitive.
Keep implementation, barrel exports, stories, tests, `README.md`, and `DESIGN.md` aligned. Even
while the package is `0.x`, call out breaking changes and provide migration guidance; deprecate old
names before removal and keep aliases tied to the same source of truth.
