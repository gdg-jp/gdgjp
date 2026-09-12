# AppShell

## Use case

Use as an application frame with `brand`, `navigation`, and `children` as required regions and `header` as an optional region. It composes an icon-collapsible desktop Sidebar with a working trigger, a mobile Sheet, a skip link, and a main focus target. Use the Sidebar family directly only for finer control.

Avoid: putting routing, account-menu data fetching, or permission checks into the shell itself.

## Public API

`AppShell`. Check `ui/src/components/AppShell/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<AppShell brand="GDG Apps" navigation={<Nav />} header={<Header />}><Outlet /></AppShell>
```

See `ui/src/components/AppShell/AppShell.stories.tsx` for states, compositions, and narrow-width layouts.
