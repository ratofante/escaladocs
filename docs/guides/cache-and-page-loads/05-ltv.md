---
title: "LTV"
sidebar_label: "5. LTV"
sidebar_position: 5
description: "After this chapter you can predict which clicks on the LTV page cost a request and which cost nothing, and how old the grid on screen can be before the server recomputes it. You can also explain why one stored answer holds four grids, not one."
---

# LTV

*After this chapter you can predict which clicks on the LTV page cost a request and which cost nothing, and how old the grid on screen can be before the server recomputes it. You can also explain why one stored answer holds four grids, not one.*

<small>~8 min · Built on: ESC-755, docs/features/client-cache/README.md</small>

:::tip[In plain words]

Ana opens LTV from the sidebar on 2026-11-16 at 9:15. The page frame appears at once: the header with her currency (ARS) and her saved window (365 days), the banner, the metric bar, and a cohort matrix drawn in grey blocks. The blocks already have the final shape: thirteen rows, one per month from November 2025 to November 2026, and thirteen columns, one per month since each cohort's first purchase. A spinner turns in the header.

Half a second later the numbers fill the blocks. They were computed earlier, with yesterday as the last day, and the server kept them. Nobody waited for the data warehouse.

Ana switches the window from 365 to 90 days. The matrix shrinks to four rows (August to November) and four columns, instantly. No spinner, no request: the 90-day grid came in the same answer.

Then she changes the currency to USD. Now the spinner turns: USD grids are a different answer her browser has never seen. If a teammate opened LTV in USD earlier, the server has it stored and it arrives in half a second. If not, the server computes the four USD grids now, about two seconds on the largest stores, and keeps them for the whole org. Going back to ARS costs nothing: those grids are still in her browser.

:::

## 1. One entry per org, currency and day

The LTV page shows cohort grids: rows of customers grouped by the month of their first purchase, columns of months since then. A cell is not a sum of days, so this page cannot use the per-day cache of [Ads](03-ads.md). It uses the other server cache from [chapter 1](01-the-big-picture.md), the range cache, which stores one whole answer under one key. `ltvCohortsRequest` builds that key: the surface `ltv`, the org, and a parameter bag with the code version, the currency, the "as of" day, the org's sorted stores and sources, and its IVA and FX settings. Anything that changes a number is in the bag; the window is not. Its range: the 365-day window's first cohort month to the "as of" day.

```ts title="app/(app)/(analytics)/(advanced)/ltv/cohorts-data.ts · L73–L96"
export function ltvCohortsRequest(
  args: LtvArgs,
  currency: string,
  asOf: string
): RangeReportRequest {
  return {
    surface: LTV_SURFACE.id,
    orgId: args.orgId,
    params: {
      code: LTV_CODE_VERSION,
      currency,
      asOf,
      stores: args.storeIds,
      sources: args.sources,
      meliIva: args.meliIva,
      preferredArs: args.preferredArs,
      dollarFee: args.dollarFee,
    },
    sources: SOURCES,
    start: firstCohortMonth(asOf, LARGEST_WINDOW_DAYS),
    end: asOf,
    maxAgeMs: LTV_MAX_AGE_MS,
  };
}
```

:::info[Why this way]

The window stays out of the key so one answer serves every window and a window change never leaves the browser. One entry per window would have meant four entries per currency and day, a request on every switch, and four recomputations when a mark moves. The "as of" day is in the key on purpose: when the day changes, the next ask computes a new entry once.

:::

## 2. Four grids, one NCPA pass

The stored answer holds four grids, one per window (365, 180, 90 and 60 days), each from its own ClickHouse query. `getLtvCohortGrids` runs the four in parallel and, alongside them, one pass over the monthly ad spend and new-customer orders (the NCPA inputs) for the 365-day span. That pass is shared: every window starts on a month boundary, so the monthly sums a smaller window looks up are the same numbers.

```ts title="lib/server-functions/reporting/ltv.ts · L139–L157"
export async function getLtvCohortGrids(
  params: Omit<LtvCohortReportParams, 'windowDays'>
): Promise<LtvCohortGrids> {
  const { orgId, storeIds, sources, currency = 'USD' } = params;
  const asOf = resolveAsOf(params.asOf);
  const context = await gridContext(orgId, storeIds, sources);
  const [ncpa, ...grids] = await Promise.all([
    ncpaByMonth(context.orgIds, currency, firstCohortMonthOf(asOf, 365), asOf),
    ...LTV_GRID_WINDOWS.map((windowDays) =>
      queryCohortGrid(context, storeIds, sources, windowDays, asOf, currency)
    ),
  ]);
  return Object.fromEntries(
    LTV_GRID_WINDOWS.map((windowDays, index) => [
      windowDays,
      attachCohortNcpa(grids[index], ncpa.spendByMonth, ncpa.ncOrdersByMonth),
    ])
  ) as LtvCohortGrids;
}
```

:::info[Why this way]

The obvious shortcut, compute the 365-day grid and cut it down, gives wrong numbers. Tiendanube flags `is_new_customer` on more than one order of the same customer. Each window puts that customer in the cohort of the first flagged order inside its own range, so the same month has a different cohort size at 90 days than at 365. Four real queries keep every stored grid equal to the live report of its window. A test against the real databases (`ltv-cohorts.live.test.ts`, by hand with `npm run test:report`) proves it on real orgs: it stores the entry, reads it back and compares each grid with its window's live report cell by cell, plus the table, total and average rows the page draws (counts exact, money within `1e-10`). It writes only TEMP tables.

:::

## 3. Valid by marks, for up to a day

A stored entry is not trusted forever. The range cache keeps with it a fingerprint of the write marks of the tables it read (chapter 1 introduces them; [Dashboard](02-dashboard.md) covers the older marks before the 125-day window). The LTV entry reads four tables, all marked: `orders`, `ad_performance`, `cost_daily` and `currency_rate` (`LTV_SURFACE`). On every read the cache recomputes the fingerprint against the org's current marks and compares. It also applies an age ceiling: `isValid` defaults to one hour (`FULL_RECALCULATION_INTERVAL_MS`), but a request may pass its own `maxAgeMs`, and LTV passes `LTV_MAX_AGE_MS`, 24 hours.

```ts title="lib/server-functions/reporting/cached-range-report.ts · L121–L128"
function isValid<Data>(
  entry: StoredRangeEntry<Data>,
  hash: string,
  now: number,
  { maxAgeMs = FULL_RECALCULATION_INTERVAL_MS }: Pick<RangeReportRequest, 'maxAgeMs'>
): boolean {
  return entry.marksHash === hash && now - entry.computedAtMs < maxAgeMs;
}
```

:::info[Why this way]

The hourly ceiling exists for pages that read tables no mark can watch. Every table LTV reads is marked, so an hourly ceiling would only have recomputed the heaviest query of the app for nothing. The grid ends yesterday, so the day boundary renews it anyway, and the marks catch any reprocess in between.

:::

:::warning[Gotcha]

Do not carry the dashboard's one-hour rule into this page: LTV is the one caller that raises it, and only because all of its sources are marked (the README agrees). A new unmarked source in the LTV query must bring the ceiling back to the default, or the entry would serve that table's changes a day late.

:::

## 4. Stale is served, then recomputed behind the response

An entry that fails the check is not thrown away. `cachedRangeReport` answers with the stored grids flagged `isStale` and schedules a recomputation after the response, if it can claim the entry and a global slot is free. When no entry exists, the first asker computes it inside the request under a lease; anyone asking meanwhile waits up to eight seconds, then gets "not yet", a 202 from the route.

```ts title="lib/server-functions/reporting/cached-range-report.ts · L285–L300"
  const { key, hash, stored } = state;
  if (!stored) {
    return {
      data: await calculateMissing(request, key, hash, request),
      isStale: false,
      source: 'computed',
    };
  }
  touchLater(key, stored, now);
  if (isValid(stored, hash, now, request)) {
    return { data: stored.data, isStale: false, source: 'cache' };
  }

  await recalculateLater(request, key, hash, request);
  return { data: stored.data, isStale: true, source: 'cache' };
}
```

:::info[Why this way]

Once an org has an entry, ClickHouse never runs inside a user's request for this page again: a reprocess or a new day costs one background computation, not a two-second wait for the next visitor. Blocking until fresh is what the old server-rendered page did. The browser polls a stale answer every five seconds (`STALE_POLL_MS`) until the fresh one lands.

:::

## 5. The route and the preload flag

The browser gets the grids from `GET /api/ltv/cohorts?currency=`. The route runs the page's gate (reports permission, Analytics access pass, advanced plan, through the shared `authorizeAdvancedPage`), resolves the org's key arguments, fixes the "as of" day with `ltvAsOf` (the UTC day before now) and calls `readLtvCohorts`: `cachedRangeReport` with the four-grid computation plugged in. The answer adds the surface's version (`ltvFreshness`). With `ifCached=1` the route never computes: it peeks Postgres with `peekLtvCohorts`, answers 200 with what is stored or 204 with nothing, and queues the computation after the response only while a slot under `PRELOAD_SLOT_CEILING` is free. The browser warm-up asks with that flag; the server warmer `ltv:` peeks the same entry and computes a missing one under the same ceiling ([chapter 9](09-warm-up.md)).

```ts title="app/api/ltv/cohorts/route.ts · L62–L102 (trimmed)"
      const args = await resolveLtvArgs(orgId);
      if (!args) return NextResponse.json({ error: 'No store' }, { status: 404 });
      const asOf = ltvAsOf(Date.now());
      …
      const cohorts = await readLtvCohorts(args, currency, asOf);
      const data: LtvCohortsData = {
        ...cohorts.data,
        ...(await ltvFreshness(orgId)),
        isStale: cohorts.isStale,
        source: cohorts.source,
      };
      return answer(NextResponse.json(data), cacheOutcome([cohorts]));
```

:::info[Why this way]

One route with two modes keeps a single place that names the entry: same `asOf` rule, same key. A preload that could compute in the request would let idle tabs take the last global slot from a real visitor, so the flag forbids it and leaves one slot free.

:::

## 6. The browser's one query per currency

The server component (`page.tsx`) sends the frame and no numbers: the saved window and the shared currency. In the browser, `client.tsx` owns one TanStack query per currency, keyed by `ltvCohortsKey`. The answer never goes stale on its own (`staleTime: Infinity`), stays in memory two hours (`SURFACE_GC_TIME_MS`) and is written to the device under the same key. The table on screen is `projectLtvWindow(data, windowDays)`, a pure pick of one grid. The window selector (`SelectWindowDays`) hands the new value to the page at once, starts a navigation mark and saves the preference afterwards. The currency selector writes the shared preference, which changes the query key: a currency in memory costs nothing, a new one fetches.

```tsx title="app/(app)/(analytics)/(advanced)/ltv/client.tsx · L110–L127"
  const cohorts = useQuery<LtvCohortsData>({
    queryKey: scope
      ? ltvCohortsKey(scope, { currency })
      : ['surface', 'no-scope', LTV_SURFACE.id, 'cohorts', currency],
    // Never null without `ifCached`: only a preload can be answered with nothing.
    queryFn: async ({ signal }) =>
      (await fetchLtvCohorts({ currency }, {}, signal)) as LtvCohortsData,
    enabled: !loading && scope !== null,
    staleTime: Infinity,
    gcTime: SURFACE_GC_TIME_MS,
    persister: persister
      ? persistUnlessPending(persister, {
          onAnswer: (from) => setFromDevice(from === 'device'),
        })
      : undefined,
    retry: retryUnlessBlocked,
    refetchInterval: (query) => (query.state.data?.isStale ? STALE_POLL_MS : false),
  });
```

:::info[Why this way]

Before ESC-755 the server component awaited the grid, so every visit and window change was a server round trip with ClickHouse behind it. A browser query lets the frame paint first, lets the device answer a repeat visit with no network, and makes a window change a local pick. Two refetch triggers remain: a grid whose `asOf` is an earlier day is shown while the current day's is fetched behind it; and a higher surface version from the versions poll invalidates the LTV queries. The navigation mark ends in `useNumbersReady`, keyed by currency and window, so a switch served from memory still records its time ([chapter 10](10-measuring.md)).

:::

:::warning[Gotcha]

The "as of" day is UTC. For Ana in Buenos Aires the grids flip to a new day at 21:00 local time, not at midnight; the first asker in the org after that pays the new entry's computation.

:::

## 7. The frame first: loading.tsx and the skeleton shape

The page keeps a `loading.tsx`. It renders the same client component with `loading` set, which disables the query and draws the matrix as skeleton blocks. Everything it reads (session, cookies, preferences) the layouts above already read for the same request, so the frame waits on no data. The blocks are not a generic placeholder: `ltvSkeletonShape` computes the rows and columns the real table will have for the chosen window, with the query's own "yesterday" and "first cohort month" rules.

```ts title="app/(app)/(analytics)/(advanced)/ltv/skeleton-shape.ts · L15–L27"
export function ltvSkeletonShape(
  windowDays: LtvWindowDays,
  now: Date = new Date()
): { monthIndexes: number[]; cohorts: number } {
  const asOfMonth = startOfMonth(subDays(now, 1));
  const firstCohortMonth = startOfMonth(subDays(subDays(now, 1), windowDays));
  const span = differenceInCalendarMonths(asOfMonth, firstCohortMonth);
  const columns = Math.min(span, WINDOW_MONTHS[windowDays]) + 1;
  return {
    monthIndexes: Array.from({ length: columns }, (_, i) => i),
    cohorts: span + 1,
  };
}
```

:::info[Why this way]

A skeleton with the final shape means the numbers replace the blocks without the table jumping. Dropping `loading.tsx`, as [Monitoring](08-monitoring.md) did, would leave a blank area while the server component resolves session and preferences: cheap, but worth painting the frame during. Then the same client mounts with the query enabled, and the header spinner (`LtvRefreshSpinner`) turns while a request is in flight.

:::

## What is different on this page

- **Range cache with a one-day range.** The key carries the "as of" day: one live entry per currency, retired by the day boundary. The dashboard's range entries are keyed by the range the user picked.
- **No sum in the browser.** Ads, Products and Customer Journey add stored days up in the browser. A cohort cell is a distinct-customer computation; LTV only picks a grid.
- **Currency inside the key, window outside.** Each currency is its own entry and browser query; the window is a local pick over the same entry.
- **A 24-hour ceiling instead of one hour.** All four source tables are marked: the one range entry allowed a full day on marks alone.
- **Four queries per computation.** More ClickHouse work, accepted because a cut of the 365-day grid would be wrong.

## Follow a request

1. **Browser** · Ana clicks LTV in the sidebar at 9:15 (12:15 UTC). `SidebarLink` starts a page mark. Next streams `loading.tsx`: the client with `loading`, ARS and 365 days from her preferences, and `ltvSkeletonShape(365)`: 13 cohorts by 13 month indexes.
2. **Server component** · `page.tsx` checks `org:reports:read` and the org's stores, reads the preferences and renders the client with no grid (a `peekLtvCohorts` seed only with `DASHBOARD_SEED_ROWS=1`, never in production).
3. **Browser** · `client.tsx` mounts the query under `ltvCohortsKey(scope, { currency: 'ARS' })`. Nothing in memory or on the device: `fetchLtvCohorts` calls `GET /api/ltv/cohorts?currency=ARS`.
4. **API route** · `authorizeAdvancedPage` passes, `resolveLtvArgs` builds the key arguments, `ltvAsOf` gives 2026-11-15, `readLtvCohorts` calls `cachedRangeReport`.
5. **Postgres** · Marks read, key hashed, entry found. `isValid`: same fingerprint, under 24 hours old. Answer `source: 'cache'`, `isStale: false`, no ClickHouse. Had a mark moved overnight: same grids, `isStale: true`, and `recalculateLater` queues the four queries.
6. **Browser** · `projectLtvWindow(data, 365)` fills the matrix; `useNumbersReady` ends the mark with source `network`; the persister writes the answer to the device.
7. **Browser** · Ana picks 90 days. `SelectWindowDays` starts a range mark and calls `setWindowDays(90)`; `projectLtvWindow(data, 90)` gives 4 cohorts by 4 month indexes from the same answer. The mark ends with source `memory`.
8. **Browser** · Ana picks USD. `CurrencySelector` writes the shared preference, the query key changes, USD is not in memory: `GET /api/ltv/cohorts?currency=USD` goes out and the spinner turns.
9. **API route, ClickHouse** · No USD entry for 2026-11-15: `calculateMissing` claims the lease and `getLtvCohortGrids` runs four cohort queries plus the NCPA pass, about two seconds on the largest orgs. Saved and answered `source: 'computed'`; a second tab asking meanwhile waits up to eight seconds, then gets 202 and retries every three. The USD 90-day grid appears.

## Where to look

| Role | File |
| --- | --- |
| Key, `readLtvCohorts`, `peekLtvCohorts`, `LTV_CODE_VERSION`, `LTV_MAX_AGE_MS` | `app/(app)/(analytics)/(advanced)/ltv/cohorts-data.ts` |
| Four cohort queries, shared NCPA pass | `lib/server-functions/reporting/ltv.ts` |
| Range cache: `cachedRangeReport`, `isValid`, the lease | `lib/server-functions/reporting/cached-range-report.ts` |
| `LTV_SURFACE`, `SURFACE_GC_TIME_MS` | `lib/cache/surface.ts` |
| Browser key and fetcher (202 retry); `ltvAsOf`, `projectLtvWindow` | `lib/ltv/surface.ts`, `lib/ltv/project-window.ts` |
| Route, gate, `ifCached` mode | `app/api/ltv/cohorts/route.ts`, `app/api/_lib/advanced-route-context.ts` |
| Server component (frame, optional seed); client (query, window pick, mark) | `app/(app)/(analytics)/(advanced)/ltv/page.tsx`, `app/(app)/(analytics)/(advanced)/ltv/client.tsx` |
| Loading state and skeleton shape | `app/(app)/(analytics)/(advanced)/ltv/loading.tsx`, `app/(app)/(analytics)/(advanced)/ltv/skeleton-shape.ts` |
| Window selector (starts the range mark); header spinner | `components/ltv/select-window-days.tsx`, `components/ltv/refresh-spinner.tsx` |
| Server warmer `ltv:`; default ceiling and slot count | `lib/server-functions/warmup/warmers.ts`, `lib/dashboard/snapshot/model.ts` |
| Live comparison against real orgs | `lib/server-functions/reporting/ltv-cohorts.live.test.ts` |

## Terms

- **`asOf`**: The grids' last day: the UTC day before now (`ltvAsOf`). In the key. (README: "la fecha 'al'")
- **window**: 365, 180, 90 or 60 days. A page-local pick, never in the key. (README: "ventana")
- **grid**: One window's cohort rows as the live report returns them; the entry holds four. (README: "grilla")
- **entry**: One `surface_range_cache` row under surface `ltv`: four grids of one org, currency and `asOf`.
- **`LTV_CODE_VERSION`**: In the key; bumping it retires every stored entry.
- **`LTV_MAX_AGE_MS`**: The entry's age ceiling, 24 hours, instead of the default hour.
- **NCPA pass**: Monthly ad spend and new-customer orders behind each cohort's NCPA, run once over 365 days.
- **`ifCached`**: The route's preload mode: never computes in the request; 200 with what is stored, 204 with nothing.
