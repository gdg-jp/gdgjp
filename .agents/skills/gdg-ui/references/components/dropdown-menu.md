# DropdownMenu

## Use case

Use for a short action menu opened from a button. Use Item onSelect, disabled, group/label/separator, and let Radix handle keyboard focus and Escape. The Trigger must have a label that makes the action clear.

Avoid: using it for form-value selection or always-visible navigation, or making it the only entry point to an important action.

## Public API

`DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuGroup`, `DropdownMenuItem`, `DropdownMenuCheckboxItem`, `DropdownMenuRadioGroup`, `DropdownMenuRadioItem`, `DropdownMenuLabel`, `DropdownMenuSeparator`. Check `ui/src/components/DropdownMenu/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<DropdownMenu><DropdownMenuTrigger asChild><IconButton aria-label="More"><MoreHorizontal aria-hidden="true" /></IconButton></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem onSelect={edit}>Edit</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
```

See `ui/src/components/DropdownMenu/DropdownMenu.stories.tsx` for states and compositions.
