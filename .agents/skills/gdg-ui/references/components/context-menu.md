# ContextMenu

## Use case

Use for supplementary actions from a right-click or context-menu gesture. Keep the target's normal interaction path, and compose Content/Item and any checked/submenu state according to the Radix contract.

Avoid: making actions reachable only through a context menu for touch or keyboard users. Do not use it for a primary action or all navigation.

## Public API

`ContextMenu`, `ContextMenuTrigger`, `ContextMenuContent`, `ContextMenuItem`, `ContextMenuGroup`, `ContextMenuRadioGroup`, `ContextMenuSub`, `ContextMenuSubContent`, `ContextMenuSubTrigger`, `ContextMenuCheckboxItem`, `ContextMenuRadioItem`, `ContextMenuLabel`, `ContextMenuSeparator`, `ContextMenuPortal`, `ContextMenuArrow`. Check `ui/src/components/ContextMenu/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<ContextMenu><ContextMenuTrigger>Target</ContextMenuTrigger><ContextMenuContent><ContextMenuItem onSelect={rename}>Rename</ContextMenuItem></ContextMenuContent></ContextMenu>
```

See `ui/src/components/ContextMenu/ContextMenu.stories.tsx` for states and compositions.
