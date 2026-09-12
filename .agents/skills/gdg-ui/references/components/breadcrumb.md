# Breadcrumb

## Use case

Use for hierarchical navigation to the current location. Pass `li` elements as children and place linkable ancestors and the current page in order. The component provides the ordered list; the app must explicitly add `aria-current="page"` to the final current-page element.

Avoid: using it as plain slash-separated text, a stepper, or tabs within the same level.

## Public API

`Breadcrumb`. Check `ui/src/components/Breadcrumb/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<Breadcrumb><li><Link href="/events">Events</Link></li><li aria-current="page">Edit</li></Breadcrumb>
```

See `ui/src/components/Breadcrumb/Breadcrumb.stories.tsx` for states and compositions.
