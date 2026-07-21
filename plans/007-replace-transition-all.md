# 007 — Replace broad transition-all utilities

- **Status**: TODO
- **Commit**: 2257801
- **Severity**: MEDIUM
- **Category**: Performance
- **Estimated scope**: 4 files, 5 class-string edits

## Problem

Five interactive elements transition every animatable property:

```tsx
// wiki/app/routes/search.tsx:335 and :449 — current
className="block rounded-lg border border-gray-200 bg-white p-4 transition-all hover:border-blue-500/40 hover:shadow-sm"
```

```tsx
// wiki/app/routes/recent.tsx:133 — current
className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-white p-4 transition-all hover:border-blue-500/40 hover:shadow-sm"
```

```tsx
// wiki/app/routes/_index.tsx:224 — current
className="... shadow-[3px_3px_0px_0px_#000] transition-all hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0px_0px_#000]"
```

```tsx
// wiki/app/routes/about.tsx:39 — current
className="... shadow-[4px_4px_0px_0px_#000] transition-all hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_0px_#000]"
```

`transition-all` can interpolate unintended layout or paint-heavy properties after unrelated style
changes.

## Target

Cards must transition only border color and box shadow; CTAs must transition only transform and box
shadow. Use the existing micro duration and strong ease-out:

```tsx
transition-[border-color,box-shadow]
duration-[var(--motion-duration-micro)]
ease-[var(--motion-ease-out)]
```

```tsx
transition-[transform,box-shadow]
duration-[var(--motion-duration-micro)]
ease-[var(--motion-ease-out)]
```

Gate transform hover effects to precise hover devices with Tailwind's
`[@media(hover:hover)_and_(pointer:fine)]:hover:` arbitrary variant, or add an equivalent scoped CSS
media query. Color/shadow hover may remain on all pointer types if it does not create movement.

## Repo conventions to follow

- `wiki/app/components/ui/button.tsx:8,85` explicitly lists transition properties and applies the
  shared micro duration/ease tokens.
- Tokens are `140ms` and `cubic-bezier(0.23, 1, 0.32, 1)` at `wiki/app/app.css:152,157`.

## Steps

1. Replace both search-card `transition-all` utilities with the card target list.
2. Apply the same replacement to the Recent card.
3. Replace the home CTA with the CTA target list and gate its translate hover utilities to hover/
   fine-pointer devices.
4. Repeat for the About CTA.
5. Run a repository search and confirm no `transition-all` remains under `wiki/app`.

## Boundaries

- Do NOT change colors, shadows, transform distances, layout, or copy.
- Do NOT add JS hover detection.
- Do NOT broaden this plan outside `wiki/app`.
- If new `transition-all` uses appeared after commit `2257801`, report them before expanding scope.

## Verification

- **Mechanical**: run `pnpm --filter @gdgjp/wiki typecheck`, `pnpm lint`, and
  `rtk rg -n 'transition-all' wiki/app`; the final search should return no matches.
- **Feel check**: hover every affected card/CTA on desktop and confirm the existing visual response
  remains. In mobile device emulation, tap CTAs and confirm no sticky translate state appears.
- **Done when**: every affected element transitions only its authored hover properties.

