---
title: "Monitoring"
sidebar_label: "8. Monitoring"
sidebar_position: 8
description: "After this chapter you can predict which ranges of the Pixel Monitoring page cost no request, which ones still go to ClickHouse, and what its cache header means when several stored pieces answer together. You can also say why the page has no loading file and why its second view stays out of the cache."
---

# Monitoring

*After this chapter you can predict which ranges of the Pixel Monitoring page cost no request, which ones still go to ClickHouse, and what its cache header means when several stored pieces answer together. You can also say why the page has no loading file and why its second view stays out of the cache.*

<small>~11 minBuilt on: ESC-756, docs/features/client-cache/README.md ("Ejemplo resuelto: Monitoring")</small>

:::tip[In plain words]

Sunday, 16 November 2026, 9:28. Ana opens the app on her phone and lands on the dashboard. While she reads it, the server brings its copy of the Pixel monitoring figures up to date for the last four months, and her browser, once idle, quietly asks for that copy and keeps it.

At 9:30 she taps Monitoring. Header, platform selector and date picker are there at once, with Last 7 days selected, and the cards, chart and table already show numbers: deliveries sent to Meta, events Meta says it received, the quality score of each event, each with a small arrow against the seven days before. Nothing was requested when she tapped; the browser drew from what it kept at 9:28.

She picks Last 30 days. The numbers change instantly, arrows included: the browser holds every day it needs for the thirty days and the thirty before them, so it adds them up differently. Then she picks a six-month range, back to May. Now the cards, chart and table turn into skeletons inside the same layout for a second or two, then fill. A half year and its previous half year are more days than the browser keeps, so that range went to the server, and the server to ClickHouse, as the page always worked. Had she switched the selector to Klaviyo, that view would have asked the server for every range, as it always has.

:::

## 1. Up to five day keys under one surface

The Meta view shows three things, each from one ClickHouse table: deliveries the Pixel sent to every destination, from the dispatch log (`capi_dispatch_log`); events Meta reports it received, from the hourly snapshot `events_count`; and quality scores (EMQ, match rate, coverage) from the hourly snapshot `events_quality`. Each is a day key of the per-day cache that [Ads](03-ads.md) introduced, under one surface named `monitoring`: for every day of the 125-day window, the exact rows the live query returns for that day. The counts and quality keys carry the org's sorted Meta pixel ids; an A/B comparison pixel adds its counts and quality as two more keys; no Meta pixel, no counts key. The dispatch key is the odd one: the log has no write time a mark could watch, and a daily mark on it cost 70 ms on the largest org, so it declares the append-only rule instead (a stored day is current for an hour, and for good once computed an hour after it ended).

```ts title="app/(app)/pixel/(product)/monitoring/monitoring-data.ts · L106–L125"
  const dispatch: KeyPlan<CapiDispatchStatsRow> = {
    part: 'dispatch',
    // Design §2: the mark costs 70 ms on the largest org, so the append-only rule instead.
    request: { ...base({ kind: 'dispatch' }, []), freshness: 'append-only' },
    calculation: {
      computeDays: (start, end) => computeDispatchDays(orgId, { start, end }),
      ...byDate,
    },
  };
  return [
    dispatch,
    ...(pixels.own.length > 0 ? [counts('counts', pixels.own)] : []),
    quality('quality', pixels.own),
    ...(pixels.comparison
      ? [
          counts('comparisonCounts', [pixels.comparison]),
          quality('comparisonQuality', [pixels.comparison]),
        ]
      : []),
  ] as KeyPlan<unknown>[];
```

:::info[Why this way]

One key per source, not one holding the three, so a re-ingested quality snapshot for 5 November leaves only that day of the quality key stale. The alternative, the old five-minute in-memory result per range, had no version: an open tab never learned of new deliveries, and every range change was three ClickHouse queries.

:::

## 2. The range is built in the browser

Every figure on the page is a sum or an average over days, and every trend arrow compares the range with the equal-length period right before it. So given the window's day rows, the browser filters the days of each period and runs the same aggregation functions the live route runs. Those functions (`buildStats`, `buildEventsQuality`, `buildPixelEventCounts`) moved to a client-safe module that the server files re-export, so there is one implementation. `buildPixelAnalytics` assembles the response shape the view already consumed: previous period included, comparison pixel without one, as the route does. Quality over a range stays the mean of the daily means.

```ts title="lib/pixel/monitoring/build.ts · L347–L383"
export function buildPixelAnalytics(
  days: MonitoringDays,
  { from, to }: { from: string; to: string }
): PixelAnalyticsData {
  const prev = previousPeriodRange(from, to);
  const comparisonQuality = days.comparison
    ? buildEventsQuality(within(days.comparison.quality, from, to), from, to)
    : null;
  const qualityPrevious = buildEventsQuality(
    within(days.quality, prev.from, prev.to),
    prev.from,
    prev.to
  );
  return {
    stats: buildStats(within(days.dispatch, from, to), from, to),
    previous: toPreviousPeriodStats(
      buildStats(within(days.dispatch, prev.from, prev.to), prev.from, prev.to)
    ),
    quality: buildEventsQuality(within(days.quality, from, to), from, to),
    …
  };
}
```

:::info[Why this way]

Per-range results would have meant one entry per range and a round trip on every picker change. Days stored once make any range inside the window free; the previous period is only "more days". A live test on three orgs at 7 and 30 days matched the route exactly.

:::

## 3. One query for the window, or the live route

The view's hook, `usePixelAnalytics`, decides per range. It computes the previous period and checks that both it and the range fall inside the cache window (125 days ending today, so at most a 62-day range fits). If so, one TanStack query keyed by `monitoringDaysKey`, with no range in the key, kept in memory for two hours and on the device, refetched when the surface's version moves and polled every 5 seconds while flagged stale. If not, the old per-range query: `POST /api/pixel/analytics`, which still queries ClickHouse in the request and has no server cache. The view component did not change; only the hook behind it did.

```ts title="components/pixel/monitoring/use-pixel-analytics.ts · L107–L130"
  const hasRange = Boolean(orgId && from && to && from <= to);
  const previousFrom = hasRange ? previousPeriodRange(from, to).from : '';
  const cacheWindow = snapshotWindow(Date.now());
  const fromDays =
    hasRange && scope !== null && previousFrom >= cacheWindow.start && to <= cacheWindow.end;

  const days = useQuery<MonitoringDaysData>({
    queryKey: scope ? monitoringDaysKey(scope) : ['surface', 'no-scope', SURFACE, 'days'],
    // Never null without `ifCached`: only a preload can be answered with nothing.
    queryFn: async ({ signal }) => (await fetchMonitoringDays({}, signal)) as MonitoringDaysData,
    enabled: fromDays,
    staleTime: Infinity,
    gcTime: SURFACE_GC_TIME_MS,
    persister: persister ? persistUnlessPending(persister) : undefined,
    retry: retryUnlessBlocked,
    refetchInterval: (query) => (query.state.data?.isStale ? STALE_POLL_MS : false),
  });
  useMonitoringVersion(days.data?.version ?? null);
  useRefreshWhenBlocked(days.error);

  const live = useQuery({
    ...pixelAnalyticsQueryOptions({ orgId, from, to }),
    enabled: hasRange && !fromDays,
  });
```

:::info[Why this way]

Widening the window for the 90-day preset would have cost every org more stored days for a range few people pick; the live route keeps the rare case as fast as before. A device copy from an earlier day may not reach today: the hook sees the stored window does not cover the range and refetches rather than drawing zeros.

:::

## 4. The route's gate is the Pixel pass

The days route, `GET /api/pixel/monitoring/days`, answers the window's rows of every key. First it repeats the page's gates in the layout's order: the Pixel read permission, then the Pixel access pass (the Pixel product's subscription check). A blocked org gets the 403 body every cached data route answers, `org_blocked`, so the browser reloads into the paywall. It deliberately skips the analytics pass check (`assertOrgAccess`): the Pixel layout never asks for it, and an org that only bought the Pixel must keep its monitoring. The same call resolves the pixel configs that decide the key list.

```ts title="app/api/pixel/monitoring/days/route.ts · L40–L58"
async function authorizeMonitoring(
  req: NextRequest
): Promise<{ orgId: string; pixels: MonitoringPixels } | NextResponse> {
  const authorized = authorizeApiRequest(req, PERMISSIONS.PIXEL_READ);
  if (authorized instanceof NextResponse) return authorized;
  const { orgId } = authorized;
  try {
    const { orgSubscription } = await getOrgContext(orgId);
    const [pass, pixelConfig] = await Promise.all([
      getPixelAccessPass(orgId, orgSubscription),
      getPixelConfig(orgId),
    ]);
    if (pass.is_blocked) return NextResponse.json({ error: ORG_BLOCKED_ERROR }, { status: 403 });
    return { orgId, pixels: monitoringPixels(pixelConfig.pixelConfigs) };
  } catch (error) {
    console.error('[monitoring-days] access check failed', { orgId, error });
    return NextResponse.json({ error: 'Unavailable' }, { status: 500 });
  }
}
```

:::info[Why this way]

Reusing the shared analytics gate was one line, and it would have locked Pixel-only orgs out of a page their layout lets them open. The route mirrors the layout, so page and data agree on who may see them.

:::

## 5. Several keys, one X-Cache

[Measuring it](10-measuring.md) explains the `X-Cache` header every cached route sends. Monitoring's one response is made of several independent cache answers, so it needs a rule to fold them: `hit` only when every key was a hit, `miss` only when every key was computed in the request, `partial` otherwise. The body's `source` follows the same fold: `cache` only for an all-hit answer. On a preload (`ifCached=1`) the route never computes: 204 with `miss` when any day is missing, 200 with `partial` when every day is stored but some are stale, the recomputation queued after the response.

```ts title="app/(app)/pixel/(product)/monitoring/monitoring-data.ts · L147–L152"
/** Every key a hit → hit; every key computed now → miss; anything else → partial. */
function combinedOutcome(outcomes: readonly CacheOutcome[]): CacheOutcome {
  if (outcomes.every((outcome) => outcome === 'hit')) return 'hit';
  if (outcomes.every((outcome) => outcome === 'miss')) return 'miss';
  return 'partial';
}
```

:::info[Why this way]

Reporting the dispatch key alone would have hidden a cold quality key behind a `hit` and the per-surface hit rate in the logs would lie; the strictest value keeps `hit` meaning "nothing touched ClickHouse". Failures degrade the same way: a counts or quality key that throws answers empty and flagged stale, as the live route renders without quality, while a dispatch failure fails the whole answer.

:::

## 6. No loading file: skeletons inside the structure

The page's server component resolves only the date range and returns the client view; the README measured it at about 190 ms. There is nothing slow to cover, so the page has no `loading.tsx`, unlike [Inventory](06-inventory.md) or [Customer Journey](07-customer-journey.md), whose servers wait on data. While the hook has no numbers, `AnalyticsView` renders its real layout with placeholders in place: metric cards in loading mode, a chart skeleton of the chart's exact height with legend stubs, the events table in loading mode with its real columns. The header, selector and date picker are never skeletons. Coming back shows none of this: the hook reads memory on its first render.

```tsx title="components/pixel/monitoring/analytics-view.tsx · L306–L327"
      ) : isPending ? (
        <>
          <div className={PANEL_CLASS}>
            {chartHeader}
            {/* `EventsOverTimeChart`'s frame: the 360px plot, then its legend of 28px buttons. */}
            <div className="flex flex-col gap-3" aria-busy="true">
              <ChartSkeleton className="h-[360px] w-full" />
              <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
                {Array.from({ length: LEGEND_PLACEHOLDERS }, (_, i) => (
                  <Skeleton key={i} className="h-7 w-20" />
                ))}
              </div>
            </div>
          </div>
          <EventsTable
            events={[]}
            quality={null}
            previousDelivered={null}
            previousEmq={null}
            loading
          />
        </>
```

:::info[Why this way]

A `loading.tsx` would have added a second, different skeleton before the real one, for a server that is already fast, and the picker would blink out and back. One loading state, drawn by the components that own the numbers, is the rule every migrated page follows.

:::

## 7. The Klaviyo view is not cached

The page has one view per connected destination with monitoring: Meta (everything above) and Klaviyo, the revenue uplift of the flows the Pixel cloned. The Klaviyo view wraps `KlaviyoUpliftTab`, which fetches `/api/klaviyo/uplift` and `/api/klaviyo/uplift/audience` per range, with its own queries and no server cache. Those routes send no `X-Cache` header: "not cached", never `miss`.

```tsx title="app/(app)/pixel/(product)/monitoring/client.tsx · L42–L46"
const MONITORING_VIEWS: Partial<Record<PixelDestinationPlatform, ComponentType<MonitoringRange>>> =
  {
    meta: AnalyticsView,
    klaviyo: KlaviyoMonitoringView,
  };
```

:::info[Why this way]

ESC-756 scoped the cache to the Meta view, where three queries plus the trend period made every range change expensive. The uplift view is visited far less; putting it on day keys waits for a ticket that measures it first.

:::

:::warning[Gotcha]

Two flags share a name. `MONITORING_SURFACE` declares `hasUnmarkedSources: true`, so its version bumps hourly and an open tab refetches today's deliveries. Each key's request in `monitoringKeys` sets `hasUnmarkedSources: false`: at key level it would make every stored day stale after an hour, which the dispatch key's `freshness: 'append-only'` replaces. "Fixing" the per-key flag to match the surface would recompute the whole window hourly.

:::

## What is different on this page

- **No `loading.tsx`.** The server only resolves the range (~190 ms); the view draws skeletons inside its real structure.
- **Several keys per response.** Up to five day keys answer one request; `X-Cache` folds to the strictest value, and a failing Meta key degrades to an empty, stale part instead of an error.
- **Long ranges on another route.** A range whose previous period starts before the 125-day window still goes to `POST /api/pixel/analytics`, live and uncached.
- **The Pixel pass, not the analytics pass.** Route and warm-ups gate on `getPixelAccessPass`, so a Pixel-only org with analytics blocked keeps its monitoring warm and readable.
- **Warmed only with a Meta destination.** On the server, the `monitoring` warmer runs in the Pixel group after Customer Journey, in no currency: it checks every key of the window with `checkDays` and reads the days under the warm-up ceiling only when one is missing or stale. In the browser, the plan adds `{ kind: 'monitoring-days' }` for a user with `org:pixel:read`, the Pixel pass open and a Meta destination, whatever the analytics pass says, fetched with `ifCached=1`. See [Warm-up](09-warm-up.md).
- **An uncached sibling view.** The Klaviyo view keeps its own per-range queries.

## Follow a request

1. **Server, 9:28** · Ana loads the dashboard. The layout schedules a warm-up tick; `pixelWarmers` sees the Pixel pass open and a Meta destination, and `monitoringWarmer` checks the window's keys, reading only stale or missing days through `readMonitoringDays`.
2. **Browser, idle** · `useWarmup` reaches the plan's `monitoring-days` entry and calls `GET /api/pixel/monitoring/days?ifCached=1`. `peekMonitoringDays` finds every day stored; 200, `X-Cache: hit`; the rows land under `monitoringDaysKey`, in memory and on the device.
3. **Server, 9:30** · Ana taps Monitoring. `page.tsx` resolves Last 7 days (10 to 16 November) and returns `PixelMonitoringView` with no numbers.
4. **Browser** · The Meta view mounts; `usePixelAnalytics` computes the previous period (3 to 9 November), sees both inside the window, and finds the days query in memory. `buildPixelAnalytics` sums both periods; numbers on the first paint.
5. **Browser** · She picks Last 30 days. Only `from` and `to` change; `buildPixelAnalytics` runs again on the same rows. No request.
6. **Browser** · She picks a six-month range. `previousPeriodRange` starts in November 2025, before the window's start (15 July), so `fromDays` is false; the live query is enabled and `AnalyticsView` shows its skeletons.
7. **API route + ClickHouse** · `POST /api/pixel/analytics` runs `getCapiDispatchStats`, `getEventsQuality` and `getPixelEventCounts` with `withPrevious: true`; no `X-Cache` header.
8. **Browser, later** · The versions poll reports a higher `monitoring` version (the hourly bump); `useMonitoringVersion` invalidates the days query, which refetches while the numbers stay on screen.

## Where to look

| Role | File |
| --- | --- |
| The key plan, reading and peeking the window, folding outcomes | `app/(app)/pixel/(product)/monitoring/monitoring-data.ts` |
| Each key's query bound to a span of days, over the live queries | `lib/server-functions/pixel/monitoring-days.ts`, `get-capi-dispatch-stats.ts`, `get-pixel-event-counts.ts`, `get-events-quality.ts` |
| The days route: gate, preload mode, X-Cache | `app/api/pixel/monitoring/days/route.ts` |
| The live per-range route for long ranges | `app/api/pixel/analytics/route.ts` |
| The surface and its sources; outcome values | `lib/cache/surface.ts`, `lib/cache/x-cache.ts` |
| The append-only rule and the per-key flags | `lib/server-functions/reporting/cached-daily-report.ts` |
| Building a range and its previous period from days; the wire shape | `lib/pixel/monitoring/build.ts` |
| The browser query key and fetch (client-safe) | `lib/pixel/monitoring/surface.ts` |
| Days or live route, version refetch, stale poll; the Meta view's skeletons | `components/pixel/monitoring/use-pixel-analytics.ts`, `analytics-view.tsx` |
| Range resolution (no loading file); selector, picker and the two views | `app/(app)/pixel/(product)/monitoring/page.tsx`, `client.tsx` |
| The uncached Klaviyo view and its routes | `components/pixel/config/klaviyo-uplift-tab.tsx`, `app/api/klaviyo/uplift/route.ts` |
| Server warmer (Pixel group) and browser plan entry | `lib/server-functions/warmup/warmers.ts`, `lib/cache/warmup-plan.ts`, `lib/cache/use-warmup.ts` |

## Terms

- **`monitoring` surface**: The Meta view's cache surface: sources `events_count` and `events_quality`, plus an unmarked source that bumps its version hourly.
- **dispatch key**: Deliveries per day and event from `capi_dispatch_log`, every platform, under the append-only rule. (README: "entregas")
- **counts key / quality key**: What Meta received, and the daily quality means, keyed by the org's sorted Meta pixel ids. (README: "conteos", "calidad")
- **comparison pair**: The counts and quality keys of the A/B comparison pixel (`getAbComparisonPixelId`), only when one is configured.
- **append-only rule**: `freshness: 'append-only'`: a stored day is current for an hour, and for good once computed an hour after it ended (UTC). No mark is consulted.
- **`fromDays`**: Range and previous period (`previousPeriodRange`) inside the 125-day window → stored days; otherwise the live route.
- **combined outcome**: The `X-Cache` fold across keys: all hit → `hit`, all computed → `miss`, else `partial`.
- **Pixel pass**: `getPixelAccessPass`: the Pixel product's subscription gate; the route and both warm-ups use it, not the analytics pass.
