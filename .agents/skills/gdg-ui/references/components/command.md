# Command

## Use case

Use for a command palette or client-side filterable action list. Compose Input and List with Empty/Loading and Group/Item; the app owns the action after selection and the open state. Give the Dialog variant accessible context equivalent to a title and description.

Avoid: using it as a regular select field or as a search-results UI for large server-side datasets.

## Public API

`Command`, `CommandInput`, `CommandList`, `CommandEmpty`, `CommandGroup`, `CommandItem`, `CommandShortcut`, `CommandSeparator`, `CommandLoading`, `CommandDialog`. Check `ui/src/components/Command/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<Command><CommandInput placeholder="Search actions" /><CommandList><CommandEmpty>No matches</CommandEmpty><CommandGroup heading="Navigate"><CommandItem value="events" onSelect={openEvents}>Events</CommandItem></CommandGroup></CommandList></Command>
```

See `ui/src/components/Command/Command.stories.tsx` for states and compositions.
