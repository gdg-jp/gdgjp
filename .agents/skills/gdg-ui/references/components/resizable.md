# Resizable

## Use case

Use for a layout whose adjacent panels can be resized by the user. Use the Group `direction`, the Panel `defaultSize/minSize/maxSize/size`, and the Handle `withHandle`. Give the Handle an accessible label and verify pointer and arrow-key behavior. Do not assume a public resize-complete callback or persistence API because none is provided.

Avoid: using it unconditionally for an ordinary responsive grid, narrow mobile layouts, or adjusting a fixed sidebar width.

## Public API

`ResizablePanelGroup`, `ResizablePanel`, `ResizableHandle`, `Resizable`, `ResizablePanels`. Check `ui/src/components/Resizable/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<ResizablePanelGroup direction="horizontal"><ResizablePanel defaultSize={40}>List</ResizablePanel><ResizableHandle aria-label="Resize panels" /><ResizablePanel>Details</ResizablePanel></ResizablePanelGroup>
```

See `ui/src/components/Resizable/Resizable.stories.tsx` for states and compositions.
