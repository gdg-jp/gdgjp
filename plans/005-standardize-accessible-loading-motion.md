# 005 — Standardize accessible loading motion

- **Status**: TODO
- **Commit**: 2257801
- **Severity**: MEDIUM
- **Category**: Accessibility
- **Estimated scope**: 4 files, about 15 lines

## Problem

Several indefinite loading indicators ignore reduced motion:

```tsx
// wiki/app/routes/ingest.$sessionId.tsx:154 — current
<div className="h-12 w-12 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" />
```

```tsx
// wiki/app/routes/ingest.$sessionId.tsx:178 — current
<span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-600" />
```

```tsx
// wiki/app/routes/search.tsx:399 — current
<div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
```

```tsx
// wiki/app/components/Skeleton.tsx:6 — current
return <div className={`animate-pulse rounded bg-gray-200 ${className}`} />;
```

`wiki/app/components/ShareDialog.tsx:543,665,681` also applies `animate-spin` to loader icons. These
animations can remain on screen for a long ingestion or network operation.

## Target

Indefinite positional/rotational motion must stop under `prefers-reduced-motion: reduce`, while text,
shape, and status changes continue to communicate progress. Use the established Tailwind pattern:

```tsx
className="animate-spin motion-reduce:animate-none"
className="animate-pulse motion-reduce:animate-none"
```

For a stopped spinner, preserve a visible asymmetric border/icon plus the adjacent loading text; do
not hide the indicator. Do not remove the default animation.

## Repo conventions to follow

- `wiki/app/components/ui/skeleton.tsx:9` is the exact exemplar:
  `animate-pulse ... motion-reduce:animate-none`.
- The ingestion screen already includes `MotionSwap`, which drops movement through the global
  reduced-motion layer; do not replace it.

## Steps

1. Add `motion-reduce:animate-none` to the ingestion ring and active-step pulse in
   `routes/ingest.$sessionId.tsx`.
2. Add it to the AI search spinner in `routes/search.tsx`.
3. Add it to all three `Loader2` spinners in `components/ShareDialog.tsx`.
4. Update the legacy `components/Skeleton.tsx` primitive to match the accessible UI skeleton.
5. Search `wiki/app` for remaining `animate-spin` and `animate-pulse` uses; apply the same rule only
   to indefinite loading feedback. Do not alter finite state transitions.

## Boundaries

- Do NOT remove progress text or live-region semantics.
- Do NOT make reduced-motion indicators invisible.
- Do NOT change loading logic, request timing, or component structure.
- Do NOT add dependencies.
- If cited code has drifted since commit `2257801`, STOP and report instead of improvising.

## Verification

- **Mechanical**: run `pnpm --filter @gdgjp/wiki typecheck`, `pnpm lint`, and
  `rtk rg -n 'animate-spin|animate-pulse' wiki/app` to confirm every indefinite use has an explicit
  reduced-motion decision.
- **Feel check**: inspect ingestion, AI search, Share dialog mutations, and sidebar skeletons with
  normal motion and reduced motion. Default indicators must animate; reduced-motion indicators must
  remain visible and stationary while adjacent status text still updates.
- **Done when**: all indefinite wiki loading animations explicitly honor reduced motion.

