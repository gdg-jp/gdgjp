# Tooltip

## Use case

Use for a short hint about an icon or control. Normally do not add another Provider because the app's ThemeProvider supplies the default Provider. Make the Trigger keyboard-focusable, keep Content brief, and use Radix props for placement.

Avoid: using it for a required label, error, long text, interactive content, or information essential to touch users.

## Public API

`Tooltip`, `TooltipProvider`, `TooltipTrigger`, `TooltipContent`. Check `ui/src/components/Tooltip/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<Tooltip><TooltipTrigger asChild><IconButton aria-label="Copy"><Copy aria-hidden="true" /></IconButton></TooltipTrigger><TooltipContent>Copy link</TooltipContent></Tooltip>
```

See `ui/src/components/Tooltip/Tooltip.stories.tsx` for states and compositions.
