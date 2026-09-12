# Menubar

## Use case

Use for keyboard navigation across multiple top-level menus in a desktop application. Give each Menu a Trigger/Content pair, and manage checked/radio/submenu state with the Radix contract.

Avoid: using it for ordinary website navigation, a single overflow menu, or mobile primary navigation.

## Public API

`Menubar`, `MenubarMenu`, `MenubarTrigger`, `MenubarContent`, `MenubarItem`, `MenubarCheckboxItem`, `MenubarRadioGroup`, `MenubarRadioItem`, `MenubarLabel`, `MenubarSeparator`, `MenubarGroup`, `MenubarSub`, `MenubarSubTrigger`, `MenubarSubContent`, `MenubarPortal`, `MenubarArrow`. Check `ui/src/components/Menubar/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<Menubar><MenubarMenu><MenubarTrigger>File</MenubarTrigger><MenubarContent><MenubarItem onSelect={save}>Save</MenubarItem></MenubarContent></MenubarMenu></Menubar>
```

See `ui/src/components/Menubar/Menubar.stories.tsx` for states and compositions.
