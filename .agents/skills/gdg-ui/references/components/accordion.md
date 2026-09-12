# Accordion

## Use case

Open and close one or more supplementary sections. Choose the Root `type="single" | "multiple"`, value/defaultValue, and collapsible behavior, and keep each Item value stable. The Trigger preserves button semantics inside a heading, while Content preserves measured-height animation and the keyboard contract.

Avoid: hiding primary content by default, using it for navigation, or deeply nesting FAQs.

## Public API

`Accordion`, `AccordionItem`, `AccordionTrigger`, `AccordionContent`. Check `ui/src/components/Accordion/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<Accordion type="single" collapsible><AccordionItem value="join"><AccordionTrigger>How to join</AccordionTrigger><AccordionContent>You can register from the event page.</AccordionContent></AccordionItem></Accordion>
```

See `ui/src/components/Accordion/Accordion.stories.tsx` for states and compositions.
