# Carousel

## Use case

Browse a small, ordered set of content horizontally (default) or vertically. Provide Content (which contains the viewport), Item, and Previous/Next, and preserve button labels, disabled boundaries, and focus. Use `opts.loop` and `setApi` only when needed.

Avoid: making it the only entry point to important content, enabling autoplay, or using it for a long navigation list.

## Public API

`Carousel`, `CarouselViewport`, `CarouselContent`, `CarouselItem`, `CarouselPrevious`, `CarouselNext`, `CarouselApi`. Check `ui/src/components/Carousel/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<Carousel><CarouselContent><CarouselItem>1</CarouselItem><CarouselItem>2</CarouselItem></CarouselContent><CarouselPrevious /><CarouselNext /></Carousel>
```

See `ui/src/components/Carousel/Carousel.stories.tsx` for states, compositions, and narrow-width layouts.
