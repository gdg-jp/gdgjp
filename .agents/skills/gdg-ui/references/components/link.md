# Link

## Use case

Use for inline navigation with native anchor props and refs. Compose React Router Link/NavLink through `asChild`. The consumer specifies target/rel, download, and current-location semantics for external links.

Avoid: disguising a button action or React Router state management as an anchor. When a router link is needed, compose the consumer's component with a part that supports `asChild`.

## Public API

`Link`. Do not strip native or Radix-derived props, events, or refs; check the current `index.ts` and `.tsx` in `ui/src/components/Link/` for exact types and defaults.

## Minimal example

```tsx
<Link href="/help">Help</Link>
```

See `ui/src/components/Link/Link.stories.tsx` for states and compositions.
