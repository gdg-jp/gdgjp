# SidebarNav

## Use case

Use as a concise sidebar navigation container. The app passes links as children and adds `aria-current="page"` to the active link. The app owns URL matching.

Avoid: use the Sidebar family when complex collapse, groups, badges, or actions are needed.

## Public API

`SidebarNav`. Check `ui/src/components/SidebarNav/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<SidebarNav><NavLink to="/events" aria-current={active ? "page" : undefined}>Events</NavLink></SidebarNav>
```

See `ui/src/components/SidebarNav/SidebarNav.stories.tsx` for states, compositions, and narrow-width layouts.
