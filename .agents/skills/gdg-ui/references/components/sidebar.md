# Sidebar

## Use case

Use as a configurable navigation frame for an admin screen. Manage open/defaultOpen/onOpenChange with the Provider, and choose the Sidebar side, variant, and `collapsible="icon" | "offcanvas" | "none"`. Compose router links with MenuButton's `asChild/isActive`, and have the app add aria-current.

Avoid: putting URL matching, permission filtering, or data fetching in Sidebar. Compose a mobile panel with Sheet.

## Public API

`useSidebar`, `SidebarProvider`, `Sidebar`, `SidebarTrigger`, `SidebarHeader`, `SidebarFooter`, `SidebarContent`, `SidebarGroup`, `SidebarGroupLabel`, `SidebarGroupContent`, `SidebarMenu`, `SidebarMenuItem`, `SidebarMenuButton`, `SidebarRail`, `SidebarInset`, `SidebarMenuBadge`, `SidebarMenuAction`, `SidebarProviderProps`. Check `ui/src/components/Sidebar/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<SidebarProvider><Sidebar collapsible="icon"><SidebarHeader><SidebarTrigger /></SidebarHeader><SidebarContent><SidebarMenu><SidebarMenuItem><SidebarMenuButton asChild isActive={active}><NavLink to="/events">Events</NavLink></SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarContent></Sidebar><SidebarInset><Outlet /></SidebarInset></SidebarProvider>
```

See `ui/src/components/Sidebar/Sidebar.stories.tsx` for states and compositions.
