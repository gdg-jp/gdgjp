# Typography

## Use case

Use for semantic typography in articles and explanatory content. Choose a `variant` or dedicated wrapper and align HTML semantics with the visual treatment. Keep long Japanese text, lists, quotes, and inline code intact.

Avoid: building application-control labels or compact metadata solely with prose components.

## Public API

`Typography`, `TypographyH1`, `TypographyH2`, `TypographyH3`, `TypographyLead`, `TypographyLarge`, `TypographySmall`, `TypographyMuted`, `TypographyP`, `TypographyBlockquote`, `TypographyInlineCode`, `TypographyList`, `TypographyVariant`. Check `ui/src/components/Typography/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<article><TypographyH1>Usage guide</TypographyH1><TypographyP>This is the body text.</TypographyP></article>
```

See `ui/src/components/Typography/Typography.stories.tsx` for states, compositions, and narrow-width layouts.
