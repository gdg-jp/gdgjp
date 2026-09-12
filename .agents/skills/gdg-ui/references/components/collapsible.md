# Collapsible

## Use case

Use as a lightweight primitive for opening and closing one supplementary region. Preserve open/defaultOpen/onOpenChange, disabled, and ref from Radix, along with the Trigger's accessible name and expanded state.

Avoid: use Accordion for multiple related sections and Dialog for modal content.

## Public API

`Collapsible`, `CollapsibleTrigger`, `CollapsibleContent`. Check `ui/src/components/Collapsible/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<Collapsible open={open} onOpenChange={setOpen}><CollapsibleTrigger>Details</CollapsibleTrigger><CollapsibleContent>Additional information</CollapsibleContent></Collapsible>
```

See `ui/src/components/Collapsible/Collapsible.stories.tsx` for states and compositions.
