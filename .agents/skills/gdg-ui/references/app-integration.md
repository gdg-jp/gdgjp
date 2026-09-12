# App integration

## Check before integration

First read the target app's existing theme bootstrap, Tailwind tokens, local UI, CSP, root layout, and tests. Do not mix legacy tokens and GDG Apps UI indiscriminately on the same screen; introduce it incrementally at the requested boundary.

Add the following to `package.json`.

```json
"@gdgjp/ui": "workspace:*"
```

## CSS

For an entry point that does not use Tailwind, load these once.

```ts
import "@gdgjp/ui/tokens.css";
import "@gdgjp/ui/components.css";
import "@gdgjp/ui/fonts.css"; // only when using bundled fonts
```

In a Tailwind v4 app stylesheet, declare the layer order first.

```css
@layer theme, base, gdg-tokens, gdg-base, gdg-components, utilities;
@import "tailwindcss";
@import "@gdgjp/ui/tailwind.css";
@import "@gdgjp/ui/components.css";
@import "@gdgjp/ui/fonts.css";
```

`tailwind.css` maps tokens to `@theme inline`; it does not include Tailwind itself or Preflight. Components are styled by the distributed CSS and do not require a consumer source scan. Consumer utilities may intentionally override styles through the public `className`, but must not break semantic tokens or component state.

## Theme and SSR

Use one `ThemeProvider` per document. The default is `defaultTheme="system"`, and the storage key is `gdg-apps-theme`. Use `<html lang="ja" suppressHydrationWarning>`, and when CSP is present, pass the request-specific nonce as `ThemeProvider nonce={nonce}`. Any DOM that changes based on the theme value must render stable content before and after mount.

Portals are mounted in `document.body` and inherit the document theme. Do not assume separate themes for partial trees. Use `forcedTheme` only for fixed displays such as catalogs. If the existing app has a custom theme bootstrap, decide the migration boundary first instead of adding duplicate scripts or providers.

## Responsibility boundary with the app

The app owns React Router `Link` composition, URL active matching, loader/action logic, form validation, authentication, data fetching, mutations, optimistic state, and i18n. Compose router links into components that support `asChild`, and have the app add `aria-current="page"` to the active link.

Implement domain-specific schedule grids, editor canvases, and domain visualizations that are not in the shared parts as app-local components, and align their color, spacing, and focus styles with semantic tokens. If a general-purpose interaction primitive is missing, propose a separate `ui/` task instead of permanently maintaining a copied Radix wrapper in the app.

## Verification

After the target app's focused tests, typecheck, and build, use Playwright for user-facing changes to verify keyboard behavior, focus restoration, Light/Dark themes, narrow widths, long Japanese text, and loading/empty/error/success states. If package imports, CSS entries, or the theme nonce change, also run `pnpm --filter @gdgjp/ui test:consumer`.
