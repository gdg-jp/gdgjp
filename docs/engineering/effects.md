# Effects and timers

Product code does not call `useEffect`, `useLayoutEffect`, `setTimeout`, `setInterval`,
`requestAnimationFrame`, or `requestIdleCallback`. These APIs are easy to misuse and
the mistakes get copied: effects that copy props into state, fetch after render,
forget a cleanup, or capture stale values through a dependency array. Timers outlive
the component that started them.

Only the shared hooks in `packages/gdg-lib/src/react/` and the delay in
`packages/gdg-lib/src/timing.ts` use these APIs directly. Everything else uses those
hooks or a React or React Router feature.

## Replacements

| Need | Use |
| --- | --- |
| Data a screen needs | Route `loader` / `clientLoader`, or `fetcher.load()` from the event that needs it |
| React to a fetcher or action result | `useValueChange(fetcher.data, onResult)`, or the submit handler |
| Value computed from props or state | Compute it during render (`useMemo` if expensive) |
| Reset state when an identity changes | A `key` on the component |
| Something that happens because the user acted | The event handler |
| Window, document, or element events | `useEventListener("window" \| "document" \| ref \| target, type, handler)` |
| Media query | `useMediaQuery(query, serverValue)` |
| Readable external store | `useSyncExternalStore` |
| Browser-only value or first client render | `useClientValue(read, serverValue)`, `useHydrated()` |
| Polling or a repeating tick | `useInterval(callback, delayMs \| null)`, `useNow(intervalMs)` |
| Temporary UI such as "Copied" | `useTransientValue(durationMs)` |
| Debounce | `useDebouncedValue(value, ms)`, `useDebouncedCallback(fn, ms)` |
| A timer started by an event | `useTimeout()` |
| Animation loop | `useAnimationFrame(callback, active)`, CSS, or `element.animate()` in a ref callback |
| DOM measurement, observers, focus | A ref callback that returns its cleanup, `autoFocus`, or a dialog's `onOpenAutoFocus` |
| Connection that lives as long as a component | `useMountEffect(connect)`, with a `key` to reconnect |
| Request deadline | `AbortSignal.timeout(ms)`, combined with `AbortSignal.any([...])` |
| Wait in non-React code | `delay(ms, signal)` from `@gdgjp/gdg-lib/timing` |

The hooks come from `@gdgjp/gdg-lib/react`. Sign-out detection in app roots uses
`useSignedOutReload()` from `@gdgjp/gdg-lib/auth/signed-out-reload`.

## The check

`node scripts/check-effects.mjs` (also `pnpm check:effects`, part of `pnpm lint`, local CI,
and the hosted repository policy job) parses product sources with the TypeScript AST.
It covers non-test JavaScript and TypeScript in `apps/*` and `packages/gdg-lib`, and skips
tests, end-to-end suites, tooling directories, and the submodules. It finds React effects
through any import form of `react` and timers called bare or on `window`, `globalThis`, or `self`.
Each error names the category of the call, its replacement, and the root cause to fix.

Existing calls are counted per file and API in `scripts/effects-baseline.json`. The
baseline only shrinks. A file may not exceed its count, and a file that drops below its
count fails until the baseline is lowered with:

```sh
node scripts/check-effects.mjs --shrink-baseline
```

That command lowers or removes entries and never adds or raises one. Do not edit the
baseline by hand to add calls.

`--staged` checks only the files in the Git index, and `--files PATH...` checks the given files.

## Allowances

An allowance is for a real external constraint, such as a protocol heartbeat, a vendor
SDK that requires polling, or a browser API with no event. "The migration is hard" is
not an external constraint; leave the call in the baseline instead.

Add an exact entry to `allowances` in `scripts/effects-policy.json`:

```json
{ "path": "apps/x/app/features/y/socket.ts", "api": "setInterval", "count": 1,
  "reason": "The relay closes sockets that send no frame for 30 seconds." }
```

The count must match the file exactly, so an allowance cannot silently cover new calls.
A new shared hook goes in `packages/gdg-lib/src/react/` with tests beside it; add a
framework module entry only for another shared module of that kind.
