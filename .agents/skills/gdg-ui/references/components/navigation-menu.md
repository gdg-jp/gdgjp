# NavigationMenu

## Use case

Use for primary website navigation with multiple levels. Compose List/Item with Link, and add Trigger/Content/Viewport only when needed; the app owns the URL and active state.

Avoid: using it for an admin sidebar, an action menu, or tabs within a single page. Do not make content reachable only by hover.

## Public API

`NavigationMenu`, `NavigationMenuList`, `NavigationMenuItem`, `NavigationMenuTrigger`, `NavigationMenuLink`, `NavigationMenuContent`, `NavigationMenuViewport`, `NavigationMenuIndicator`, `NavigationMenuSub`. Check `ui/src/components/NavigationMenu/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<NavigationMenu><NavigationMenuList><NavigationMenuItem><NavigationMenuLink asChild><NavLink to="/events">Events</NavLink></NavigationMenuLink></NavigationMenuItem></NavigationMenuList></NavigationMenu>
```

See `ui/src/components/NavigationMenu/NavigationMenu.stories.tsx` for states and compositions.
