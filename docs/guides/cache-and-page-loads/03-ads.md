---
title: "Ads"
sidebar_label: "3. Ads"
sidebar_position: 3
description: "After this chapter you can predict which clicks on the Ads page send a request and which are answered from memory, and what the server does with a day it never computed, one computed under older data, and one nobody is waiting for. The per-day cache is explained here in full."
---

# Ads

*After this chapter you can predict which clicks on the Ads page send a request and which are answered from memory, and what the server does with a day it never computed, one computed under older data, and one nobody is waiting for. The per-day cache is explained here in full.*

<small>~10 min · Built on: ESC-749, ESC-750, ESC-752, docs/features/client-cache/README.md</small>

:::tip[In plain words]

Sunday, 16 November 2026, 9:05. Ana opens the Ads page. It lands on Meta with Last 7 days. The chart card and the table columns appear at once, with grey bars where the numbers go. Her browser asks the server for Meta's numbers as one row per day for the last 125 days, not just the seven on screen. The server has most of those days stored from her visit on Friday; Saturday and today are missing, so it computes those two together, stores them, and answers. A second later the bars become numbers.

Ana switches to Last 30 days. Nothing is requested: her browser already holds the days and adds thirty of them up, so the chart and the table change in the same frame. She opens a campaign. Its ad sets were already listed by name under it, with grey cells; now the server adds up their days for those thirty days and the cells fill in. Opening the same campaign again costs nothing.

Meanwhile, once Meta's numbers were on screen and the page went quiet, her browser had asked for Google's days in the background, with a request allowed to come back empty. When Ana taps the Google tab the numbers are there instantly. Had Google never been stored, the tab would have asked like Meta did, and the quiet request would have left it ready for next time.

:::

## 1. A day entry

The per-day cache is a Postgres table where one row holds one page's numbers for one day under one key: `surface_day_cache`, keyed by org, surface (the page's id), key and day; the rows travel as gzipped JSON in `payload`. A second table, `surface_day_claim`, holds what is per key: who is computing it (`claimed_at`) and when it was last read (`last_used_at`). The key is a sha256 (`dayKey`) of what changes a day's numbers and nothing else: code version, platform or source, grain, the accounts sorted, the FX settings, the role class (`full` or `limited`) and the currency. Not the range, which is built from days; not the locale or the edit permission, so users who differ only in those share the rows. An org keeps at most `MAX_DAY_KEYS` (32) keys per page; `trimDayKeys` drops the least recently used with their days.

```sql title="docs/migrations/031_surface_day_cache.sql · L19–L37"
CREATE TABLE IF NOT EXISTS public.surface_day_cache (
  organization_id text NOT NULL,
  surface text NOT NULL,
  cache_key text NOT NULL,
  day date NOT NULL,
  payload bytea NOT NULL,
  marks_hash text NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, surface, cache_key, day)
);

CREATE TABLE IF NOT EXISTS public.surface_day_claim (
  organization_id text NOT NULL,
  surface text NOT NULL,
  cache_key text NOT NULL,
  claimed_at timestamptz,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, surface, cache_key)
);
```

:::info[Why this way]

Before ESC-750 Ads lived in the range cache of [chapter 1](01-the-big-picture.md): one entry per range and filter, up to 653 KB each, and every new range was a miss. Days make any range inside the window a sum of rows the server already has.

:::

## 2. When a stored day still holds

Chapter 1 introduced the marks: per table and per day, a fingerprint of the last write. Each stored day carries `marks_hash`, the hash of the marks of the page's `sources` on that one day plus the connections key. `dayStates` recomputes it from the org's current marks: equal is `current`, different is `stale`, absent is `missing`. A request with `hasUnmarkedSources` also calls stale any day older than `FULL_RECALCULATION_INTERVAL_MS` (one hour). A day outside the 125-day window (`snapshotWindow`) has no marks to vouch for it: `requestedDays` throws `UncacheableDaysError` before anything is read.

```ts title="lib/server-functions/reporting/cached-daily-report.ts · L202–L221"
  for (const day of days) {
    const hash = marks
      ? marksHash(marks.marks, marks.connectionsKey, request.sources, day, day, {
          olderMarks: undefined,
          windowStart,
        })
      : '';
    hashes.set(day, hash);
    const entry = stored.get(day);
    if (!entry) states.set(day, 'missing');
    else if (request.freshness === 'append-only') {
      states.set(day, isAppendOnlyDayCurrent(day, entry.computedAtMs, now) ? 'current' : 'stale');
    } else if (!marks || entry.marksHash !== hash) states.set(day, 'stale');
    else if (
      request.hasUnmarkedSources &&
      now - entry.computedAtMs >= FULL_RECALCULATION_INTERVAL_MS
    ) {
      states.set(day, 'stale');
    } else states.set(day, 'current');
  }
```

:::info[Why this way]

One hash per day, not one per key. A reprocess of five October days stales exactly those five; an order today leaves yesterday current. One version per key would have invalidated the whole window on every ad sync.

:::

## 3. Spans, the lease and the cap

`cachedDailyReport(request, calculation)` is the primitive every tenant calls. It groups the days that are not current into runs with `daySpans`: days up to `MERGE_SPAN_GAP_DAYS` (3) apart share a span; more than `MAX_RECALCULATED_SPANS` (3) spans makes the whole request one span. The tenant's `computeDays(start, end)` runs once per span, never per day. A span with a missing day is computed inside the request, only by whoever holds the key's lease: `claimDayKey` takes it for `DAY_CLAIM_LEASE_MS` (60 s). Everyone else polls the store for up to `WAIT_LIMIT_MS` (8 s), then throws `DailyReportPendingError`; the route answers 202 and the browser retries in 3 s. A span whose days are only stale is served now and recomputed after the response (`recomputeLater`, in `after()`) if `claimDayRecalculation` finds a free slot under `MAX_CONCURRENT_RECALCULATIONS` (3), one cap counted across day claims, range-cache claims and the dashboard snapshot. A request marked `onlyUnderCap` is work nobody waits for: it computes missing days only with the lease and a free slot (`claimDayKeyUnderCap`), else computes nothing and reports pending; a `{ ceiling }` lowers the bar. A failed calculation keeps the lease, so nothing retries it within the minute.

The answer is `days` (rows, never totals), `outcome` in the `X-Cache` vocabulary (`hit`, `miss`, `partial`) and `isStale`. A read-only sibling, `peekDailyReport`, reads Postgres alone and lists the current days, the stored days stale ones included, and which are missing or stale; it never claims or computes.

```ts title="lib/server-functions/reporting/cached-daily-report.ts · L420–L444"
  const spans = daySpans(toCompute) ?? [{ start: request.start, end: request.end }];
  const hasMissing = (span: SnapshotWindow) =>
    days.some((day) => day >= span.start && day <= span.end && state.states.get(day) === 'missing');
  const inRequest = spans.filter(hasMissing);
  const later = spans.filter((span) => !hasMissing(span));

  if (inRequest.length > 0) {
    const missing = days.filter((day) => state.states.get(day) === 'missing');
    let isOurTurn: boolean;
    const ceiling = capCeiling(request);
    try {
      isOurTurn =
        ceiling !== null ? await claimDayKeyUnderCap(key, ceiling) : await claimDayKey(key);
    } catch (error) {
      if (request.onlyUnderCap) throw new DailyReportPendingError();
      console.error('[day-cache] claim failed, going live', error);
      return computeLive(request, calculation);
    }

    if (!isOurTurn && request.onlyUnderCap) throw new DailyReportPendingError();
    if (!isOurTurn) {
      const stored = await waitForDays<Day>(key, request.start, request.end, missing);
      for (const day of missing) {
        served.set(day, { rows: stored.get(day)?.data ?? [], source: 'computed', isStale: false });
      }
```

:::info[Why this way]

One ClickHouse scan per span, because the cost is in the scan, not the rows. A lease, because three tabs of one org opening Ads together would otherwise run the heaviest query three times. Stale served now and fixed after the response is chapter 1's range-cache rule, applied per day.

:::

## 4. Ads keys: one per platform and grain, plus the margin

Ads is `ADS_SURFACE` (id `ads`). Each connected platform keeps four keys, one per grain: `platform` (the day's totals, what the chart draws), `campaign` (the table and the All view), `adset` and `ad` (only the days someone opened a campaign in). `adsDaysRequest` builds the request; its key carries `ADS_DAYS_CODE_VERSION` (1, bumped when a formula or stored shape changes), platform, grain, the sorted accounts of the filter, FX settings, role and currency, with sources `ad_performance` and `currency_rate`. A fifth key per org, `marginDaysRequest`, stores the four daily sums behind the store's margin, marked by `orders` and `currency_rate`, read only for the full role. `readAdsDays` reads platform, campaign and margin in parallel. The computations in `ads-days.ts` run the report's own queries with `date` as the first dimension and base metrics only (`adsDayBaseMetrics`); MercadoLibre's platform days read both feeds together. Four keys times five platforms plus the margin is 21, under the cap of 32.

Names, status, budgets and images have no day. `readAdsObjects` puts the whole `ad_objects` list in the range cache (`cachedRangeReport`) under a one-day range with no sources, so its hourly expiry is the only validity; the browser gets all of it, so the search finds ad sets and ads before their numbers exist. Google's edit references are read uncached, only for editors (`readGoogleEditRefs`).

```ts title="app/(app)/(analytics)/pixel/ads/days-data.ts · L71–L95"
export function adsDaysRequest(
  args: AdsDaysArgs,
  grain: AdsDayGrain,
  range: { start: string; end: string } = snapshotWindow(Date.now())
): DailyReportRequest {
  return {
    surface: ADS_SURFACE.id,
    orgId: args.orgId,
    params: {
      code: ADS_DAYS_CODE_VERSION,
      platform: args.platform,
      grain,
      accounts: sortedAccounts(args),
      preferredArs: args.ctx.preferredArs,
      dollarFee: args.ctx.dollarFee,
      role: args.isLimited ? 'limited' : 'full',
      currency: args.currency,
    },
    sources: AD_DAY_SOURCES,
    // `currency_rate` is marked (decision 7): a day stays current while its marks hold.
    hasUnmarkedSources: false,
    start: range.start,
    end: range.end,
  };
}
```

:::info[Why this way]

Grains as separate keys, not one key of ad-level rows: every visit needs platform and campaign rows, while ad-set and ad rows are many times more and needed only when a campaign opens. Objects apart because nothing marks them: a day entry with no mark would never go stale.

:::

## 5. The sum in the browser

`ads-surface.tsx` runs one query per platform in view, keyed by `adsDaysKey(scope, { currency, platform, accounts })`: no range in the key, so every range inside the window reads the same entry. The query is enabled only while `chartStartOf(start, end)` is inside the window. `fromDays` then builds the page with the pure helpers in `lib/pixel/ads-days/`: `sumDays` adds the base metrics of the rows in `[start, end]` per campaign or platform; `marginOf` adds the margin days and divides net by gross once; `applyPlatformFormulas` runs the platform's calculated metrics and the estimated ones (`PIXEL_EST_METRICS`, shared with the server) on the sums. `campaignTree`, `chartRows` and `allRows` hand those rows to the builders the server's report uses, so the numbers match by construction. An answer flagged `isStale` is re-asked every `STALE_POLL_MS` (5 s). Each answer also goes to the device (chapter 1's device copy, ESC-752), objects included.

```ts title="lib/pixel/ads-days/sum-days.ts · L49–L68"
export function sumDays(
  rows: readonly AdsDayRow[],
  start: string,
  end: string,
  keyOf: (row: AdsDayRow) => string | null
): Map<string, BaseSums> {
  const sums = new Map<string, BaseSums>();
  for (const row of rows) {
    if (row.date < start || row.date > end) continue;
    const key = keyOf(row);
    if (key === null) continue;
    let into = sums.get(key);
    if (!into) {
      into = {};
      sums.set(key, into);
    }
    for (const [id, value] of Object.entries(row.metrics)) into[id] = (into[id] ?? 0) + value;
  }
  return sums;
}
```

:::info[Why this way]

Base metrics stored, ratios derived after the sum: a 30-day ROAS is spend-weighted, not an average of daily ratios. Summing in the browser turns a range change into zero requests; one server entry per range is the design Ads left behind.

:::

## 6. Children on open

`campaignTree` attaches to every campaign its ad sets and ads from `ad_objects` as nodes marked `pending`: name and budget known, metrics empty. In `PixelTreeTable`, `openPending` lists the campaigns that are expanded (by click or by a search match) and still have pending children. Each gets a query keyed by `adsChildrenKey`, which does include campaign and range, calling `fetchAdsChildren` on `/api/pixel/ads/children`. There `readAdsChildren` asks the `adset` and `ad` keys for that range; a missing span is computed by `computeChildrenDays` for every campaign of the platform at once, so the second campaign opened in the same range is a Postgres read. `childrenRows` sums this campaign with the browser's formulas and `withChildren` swaps the pending nodes for real ones. Closing a campaign drops it from the list, not from the cache. A range outside the window is a 400.

```tsx title="components/pixel/ads/pixel-tree-table.tsx · L322–L338"
  // ESC-750: the open campaigns (by click or by the search) whose children are known by name only
  // ask for their numbers over this range. Closing one drops its query from this list, not from the
  // cache: opening it again in the same range is answered from memory.
  const openPending = useMemo(
    () =>
      childrenSource
        ? treeState
            .filter(
              (node) =>
                node.levelIndex === 0 &&
                node.children.some((child) => child.pending) &&
                effectiveExpanded.has(treeRowKey(node))
            )
            .map((node) => node.id)
        : [],
    [childrenSource, treeState, effectiveExpanded]
  );
```

:::info[Why this way]

Shipping every ad-set and ad day with the page would multiply the first payload for rows most visits never open. Computing a span for all campaigns means the scan happens once per range, not once per click.

:::

## 7. Preload while idle

Once a platform's numbers are on screen (`numbersReady`), an effect in `ads-surface.tsx` waits for the browser to be idle (`whenIdle`, 3 s timeout) and then, one platform at a time, asks for the days of each other connected platform not yet in the query cache, with the unfiltered key and `ifCached: true`. The route reads `?ifCached=1` and never computes inside the request: `peekAdsDaysData` peeks the three day keys and the objects entry. If every day and the objects are stored, stale ones included, it answers 200 with `isStale` set when any is stale (`X-Cache` `partial`, else `hit`). If anything was never stored, 204, and the browser keeps nothing. Either way the work is queued after the response: `readAdsDays` with `onlyUnderCap: { ceiling: PRELOAD_SLOT_CEILING }`, that is `MAX_CONCURRENT_RECALCULATIONS - 1` (2), then `readAdsObjects`. A 200 lands under the platform's own key, so the tab switch is answered from memory.

```ts title="app/api/pixel/ads/days/route.ts · L94–L117"
      if (ifCached) {
        // Queued, never computed here: the days only while a global slot is free with one more left
        // over (ESC-752: a tab preloading every platform must not take the slot a user's click
        // needs; the same ceiling as ESC-753's tick), or not at all until the next ask; the objects
        // then (a stored entry is a Postgres read, a stale one recalculates capped).
        const refreshLater = () =>
          after(() =>
            withQueryContext({ surface: ADS_SURFACE.id, mode: 'job', orgId }, async () => {
              try {
                await readAdsDays(args, { onlyUnderCap: { ceiling: PRELOAD_SLOT_CEILING } });
                await readAdsObjects(args);
              } catch (error) {
                if (error instanceof DailyReportPendingError) return;
                console.error('[ads-days] preload failed', { orgId, platform, error });
              }
            })
          );
        const stored = await peekAdsDaysData(args, canEdit);
        // Every day stored, some stale (today's moves with each ad sync): answered now, refreshed after.
        if (stored?.isStale) refreshLater();
        if (stored) return answer(NextResponse.json(stored), stored.isStale ? 'partial' : 'hit');
        refreshLater();
        return answer(new NextResponse(null, { status: 204 }), 'miss');
      }
```

:::info[Why this way]

The first preload answered only when every day was current, and today's day goes stale with every ad sync, so most preloads came back empty. The ceiling of one less than the cap means a tab preloading five platforms never takes the last slot a user's click needs.

:::

:::warning[Gotcha]

Two comments lag the code. The docblock of `app/api/pixel/ads/days/route.ts` (L50–L52) and the preload comment in `ads-surface.tsx` (L299–L301) still say `ifCached` answers 200 only when every day is current. Since ESC-752 the code answers stored days with 200 even when some are stale. The README describes the code; the comments do not.

:::

:::warning[Gotcha]

`ADS_SURFACE` declares `hasUnmarkedSources: true`, yet every Ads day request passes `false`. Both are right: the surface flag makes `surfaceVersion` rise once an hour so open tabs re-ask and pick up the hourly refresh of the objects; the request flag governs the days, which only marks can stale. The hourly re-ask is a Postgres hit.

:::

## What is different on this page

- **Days with no range in the browser key.** The dashboard of [chapter 2](02-dashboard.md) keeps its own snapshot; Ads was the first page whose browser entry is a platform's whole window, summed on the client.
- **Two caches in one answer.** Days from the per-day cache, `ad_objects` from the range cache; `X-Cache` combines them, and any mix is `partial`.
- **The server sums days once.** `readAdsChildren` is the only place the server, not the browser, adds Ads days.
- **Ranges before the window keep the old path.** A chart start before the window disables the day queries and asks `/api/pixel/ads/report` (`readAdsReport` in `report-data.ts`) under `adsReportKey`, which carries start and end; those answers stay in memory only.
- **Seeding only on staging.** `cached-page.tsx` sends no numbers by default; with `isSeedingEnabled()` it peeks each platform's days into a dehydrated query client. No `loading.tsx`: skeletons sit inside the chart card and the table rows.

## Follow a request

1. **Browser, 9:05** · `CachedAdsPage` ships the frame with no numbers. `AdsSurface` mounts, `resolveAdsRange` reads Last 7 days, and `fetchAdsDays` asks `/api/pixel/ads/days` for Meta. No device copy: Ana last visited from another laptop.
2. **API route** · `authorizeApiRequest` passes; Ana is neither Limited nor an editor. `resolveAdsViewContext` narrows the accounts; `readAdsDays` and `readAdsObjects` run in parallel.
3. **Postgres** · For each of three keys `cachedDailyReport` reads the stored days (`readStoredDays`); `dayStates` finds 15 and 16 November missing, the rest current. `daySpans` makes one span; `claimDayKey` says it is this request's turn. The objects entry is a current range-cache row.
4. **ClickHouse** · `computePlatformDays`, `computeCampaignDays` and `computeMarginDays` each scan 15–16 November once. `saveDays` gzips, upserts and releases the claim in one statement; `trimDayKeys` keeps 32 keys.
5. **API route, then browser** · `adsDaysData` adds the version from `adsFreshness`; `X-Cache` says `partial`. `fromDays` runs `chartRows` and `campaignTree` for 10–16 November; the skeletons hand over; the persister writes the answer to the device.
6. **Browser, Last 30 days** · `pushUrl` changes the URL in place. Same key, no fetch: `fromDays` recomputes the sums for 18 October to 16 November.
7. **Browser, campaign opened** · `openPending` gains the campaign; `fetchAdsChildren` calls `/api/pixel/ads/children`. `readAdsChildren` finds no `adset` or `ad` days for the range, `computeChildrenDays` scans them for every Meta campaign, `childrenRows` sums this one, `withChildren` fills the cells.
8. **Browser, idle after step 5** · `whenIdle` fires the preload: `fetchAdsDays` for Google with `ifCached`. `peekAdsDaysData` finds every Google day and the objects stored since Friday, today stale: 200 with `isStale`; `refreshLater` recomputes today under ceiling 2 after the response. `setQueryData` stores the answer under Google's key.
9. **Browser, Google tab** · The query already has data, so `fromDays` draws at once. The data is stale, so the 5 s poll re-asks and gets the recomputed day as a `hit`.

## Where to look

| Role | File |
| --- | --- |
| The two tables | `docs/migrations/031_surface_day_cache.sql` |
| Postgres access: read, save, claims, trim | `lib/server-functions/reporting/day-cache-store.ts` |
| The primitive: classify, spans, lease, recompute later, peek | `lib/server-functions/reporting/cached-daily-report.ts` |
| Window, cap, leases, key cap, span merging | `lib/dashboard/snapshot/model.ts` |
| Surface id; version rule | `lib/cache/surface.ts`, `lib/server-functions/reporting/org-marks.ts` |
| Ads keys, margin key, objects, peek for the preload | `app/(app)/(analytics)/pixel/ads/days-data.ts` |
| Day computations against ClickHouse | `lib/server-functions/reporting/ads-days.ts` |
| Sums, margin, formulas after the sum | `lib/pixel/ads-days/sum-days.ts` |
| Tree, chart and All view from days; pending children | `lib/pixel/ads-days/build.ts` |
| One query per platform, sums, preload effect | `components/pixel/ads/ads-surface.tsx` |
| Children requested when a campaign opens | `components/pixel/ads/pixel-tree-table.tsx` |
| Browser keys and fetchers | `lib/pixel/ads-report/surface.ts` |
| Days route, with the `ifCached` branch | `app/api/pixel/ads/days/route.ts` |
| Children route | `app/api/pixel/ads/children/route.ts` |
| Range report for ranges before the window | `app/api/pixel/ads/report/route.ts`, `app/(app)/(analytics)/pixel/ads/report-data.ts` |
| Server component: frame, optional seed | `app/(app)/(analytics)/pixel/ads/cached-page.tsx` |
| Idle scheduling | `lib/cache/when-idle.ts` |

## Terms

- **`per-day cache`**: One row per org, surface, key and day; any range in the window is a sum (README: "caché por día").
- **`day key`**: sha256 of what changes a day's numbers; never the range, locale or edit flag.
- **`span`**: A run of days computed in one call; days up to 3 apart share one (README: "tramo").
- **`lease`**: The right to compute a key's days for 60 s (`claimed_at`).
- **`global cap`**: At most 3 recalculations at once across every org and all three caches.
- **`onlyUnderCap`**: Compute missing days only with the lease and a free slot; else report pending.
- **`pending`**: Someone else is computing: a 202, retried in 3 s. Also a tree node whose numbers were not asked for yet.
- **`peek`**: Read what is stored without claiming, computing or building marks.
- **`margin key`**: One key per org with the four daily sums behind the store's margin; full role only.
- **`preload`**: The idle `ifCached=1` request for another platform: 200 with what is stored, 204 with nothing (README: "precarga").
