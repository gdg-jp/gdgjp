# Chart

## Use case

Use for small data visualizations. Define series labels and colors in config, and provide a legend/tooltip and an alternative description. Use semantic tokens and check Light/Dark themes and color-vision differences.

Avoid: using it as an analytics platform for large datasets, comparing values by color alone, or making it the only representation of exact values that should be shown in a table.

## Public API

`ChartContainer`, `Chart`, `ChartTooltip`, `ChartTooltipContent`, `ChartLegend`, `ChartLegendContent`, `ChartConfig`, `ChartDatum`. Check `ui/src/components/Chart/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<Chart data={data} type="bar" aria-label="Attendees by region" />
```

See `ui/src/components/Chart/Chart.stories.tsx` for states, compositions, and narrow-width layouts.
