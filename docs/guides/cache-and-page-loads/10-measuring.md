---
title: "Measuring it"
sidebar_label: "10. Measuring it"
sidebar_position: 10
description: "After this chapter you can answer three questions about any reporting page without guessing: how long a click took until numbers appeared, whether an API route answered from its cache or computed, and which page and org produced a given warehouse query. You will also know where each answer is stored and which parts of the written docs to distrust."
---

# Measuring it

*After this chapter you can answer three questions about any reporting page without guessing: how long a click took until numbers appeared, whether an API route answered from its cache or computed, and which page and org produced a given warehouse query. You will also know where each answer is stored and which parts of the written docs to distrust.*

<small>~9 min · Built on: ESC-748, ESC-755, ESC-756, docs/features/client-cache/README.md ("Medición")</small>

:::tip[In plain words]

Monday 2026-11-17, 10:00. A client writes that the Products page "feels slow this week". Rodrigo does not open the page himself, because his own click says nothing about theirs. He asks three questions in order.

First: how long did their clicks take? Every time someone clicks a sidebar entry or applies a new date range, the browser starts a stopwatch, and the destination page stops it the moment real numbers are on screen. Each stop is saved as one row with the page, the elapsed time and where the numbers came from. Rodrigo runs one query over the last seven days for that org and reads the 75th percentile for Products: 1.9 seconds, mostly from the network, not from anything the browser already held.

Second: when the browser asked the server, did the server already have the numbers? Every cache-backed answer carries a tag that says "hit", "partial" or "miss", and leaves one log line. Filtered to Products and that org: mostly "miss" on Monday morning.

Third: what did those misses cost in the warehouse? Each warehouse query is signed with the page, the kind of caller and the org. Rodrigo groups the last two hours by that signature and sees Products for that org at the top of the bytes read. Now he has a cause, not a feeling.

:::

## 1. A navigation mark starts at the gesture

The first measurement is a stopwatch that a user gesture starts and the destination page stops. The code calls it a navigation mark, and a tab holds at most one pending mark: a new gesture replaces an unfinished one, so an abandoned navigation is never recorded. Three gestures start one. A sidebar click starts a mark of kind `page` through `startPageMark`, with the current pathname as origin (`SidebarLink`, `components/app/sidebar-section-context.tsx` L74–L77); clicking the page already open starts nothing. "Aplicar" in the date selector starts a mark of kind `range` through `startRangeMark`, as does a change of the LTV window (`components/ltv/select-window-days.tsx` L47–L49, ESC-755). A full load, a typed URL and back/forward start no mark.

```tsx title="components/ds/date-range-selector.tsx · L560–L572"
  const handleApply = () => {
    if (!date?.from || !date?.to) return;
    const bounded = applyBounds(date);
    if (!bounded?.from || !bounded?.to) return;
    setDate(bounded);
    setApplied(bounded);
    setPreset(draftPreset);
    setOpen(false);
    // ESC-748: the page ends this mark when the new range's numbers are on screen.
    startRangeMark(window.location.pathname);
    updateUrlParams(bounded);
    if (onDateChange) onDateChange({ from: bounded.from, to: bounded.to });
  };
```

:::info[Why this way]

The clock starts at the user's intent, not at a page-load event, which counts full loads the cache cannot influence and stops when HTML arrives, not when numbers do. One pending mark beat a queue, which would charge the second click's wait to the first.

:::

## 2. The destination ends it with `useNumbersReady`

Only the page that receives the navigation knows when its numbers are on screen, so it ends the mark through a hook, `useNumbersReady`. The hook fires once per rising edge of a boolean "ready", and only if the pending mark was going to the current pathname: a page still mounted during a navigation must not close the next page's mark. A reset key re-arms it when what is shown changes while numbers never left the screen (a range answered from memory). The hook also reports where the numbers came from. `source` has four declared values: `device` (restored from this device's storage, see [The big picture](01-the-big-picture.md)), `network` (the query that answered got its data after the gesture), `memory` (already in the browser) and `html` (in the server's HTML). `sourceSince` picks between the middle two by comparing a query's `dataUpdatedAt` with the instant of the gesture.

```ts title="lib/perf/navigation-marks.ts · L52–L54, L92–L101"
export function sourceSince(dataUpdatedAt: number): NumbersSource {
  return pending && dataUpdatedAt >= pending.startedAtMs ? 'network' : 'memory';
}
…
export function useNumbersReady(ready: boolean, source?: NumbersSource, resetKey?: string): void {
  const last = useRef<{ key: string | undefined; ready: boolean } | null>(null);
  useEffect(() => {
    const previous = last.current;
    const wasReady = previous !== null && previous.key === resetKey && previous.ready;
    last.current = { key: resetKey, ready };
    // After commit the URL is the destination's (a router navigation or the dashboard's pushState).
    if (ready && !wasReady) endMark(source, window.location.pathname);
  }, [ready, resetKey, source]);
}
```

| Page | Where the mark ends | Reset key | `source` sent |
| --- | --- | --- | --- |
| [Dashboard](02-dashboard.md) | `SnapshotDashboardContent` | `reportKey` | `device`, `network`, `memory` |
| [Ads](03-ads.md) | `AdsSurface` | range, currency, view, accounts | `device`, `network`, `memory` |
| [Products](04-products.md) | its `client.tsx` | range, currency, level | `device`, `network`, `memory` |
| [LTV](05-ltv.md) | its `client.tsx` | currency, window | `device`, `network`, `memory` |
| [Inventory](06-inventory.md) | its `client.tsx`, when `loading` ends | range | `device`, `network`, `memory` (gotcha) |
| [Customer Journey](07-customer-journey.md) | `JourneyBlocksClient` | range, level, currency | `device`, `network`, `memory` |
| [Monitoring](08-monitoring.md) | `AnalyticsView`, when data is defined | range | `network`, `memory` |

:::info[Why this way]

A rising edge of "ready" alone misses a range the browser already held: it renders at once, "ready" never goes false, and the mark would hang until the next gesture. Keying the hook by what is shown closes those marks too.

:::

:::warning[Gotcha]

The README's table says Inventory ends its mark with `source = html`. The code does not: `app/(app)/(analytics)/(advanced)/inventory/client.tsx` L263–L267 sends `device` when the stock came from the device and `sourceSince(stock.dataUpdatedAt)` otherwise. Nobody in the repo passes `html`. History and Warehouses call `useNumbersReady` too, but their paths are not in `MARK_DESTINATION_PATHS`, so a sidebar click to them records nothing.

:::

## 3. `endMark` posts the row

When the hook fires, `endMark` turns the pending mark into one HTTP request. It computes the elapsed milliseconds, translates the destination to the stored vocabulary (`/` becomes `/dashboard`, through `pathForTracking`), and refuses two cases: a mark older than `MAX_MARK_MS` (60 000 ms: an abandoned tab) and a destination outside `MARK_DESTINATION_PATHS` (`lib/tracking/tracked-paths.ts` L27–L35, the seven reporting pages). What survives is a `POST /api/tracking` with `kind: 'mark'`; the origin may be any app path. Every failure is swallowed: a mark is never worth an error on the page.

```ts title="lib/perf/navigation-marks.ts · L60–L81"
export function endMark(source?: NumbersSource, at?: string): void {
  const mark = pending;
  if (!mark || (at !== undefined && pathOf(at) !== mark.to)) return;
  pending = null;
  try {
    const elapsed = Math.round(performance.now() - mark.startedAt);
    const path = pathForTracking(mark.to);
    if (elapsed > MAX_MARK_MS || !MARK_DESTINATION_PATHS.has(path)) return;
    void fetch('/api/tracking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'mark',
        markKind: mark.kind,
        path,
        from_path: mark.from === null ? null : pathForTracking(mark.from),
        elapsed_ms: elapsed,
        source: source ?? null,
        client_timestamp: new Date().toISOString(),
      }),
      keepalive: true,
    }).catch(() => {});
…
```

:::info[Why this way]

The mark reuses the tracking endpoint and its path vocabulary instead of a new route, with `keepalive` so a click that unloads the tab still delivers. Raw elapsed times with percentiles in SQL beat aggregating in the browser, which would hide the per-org and per-source breakdown.

:::

## 4. `page_timing` stores it

The endpoint, `app/api/tracking/route.ts`, branches on `kind === 'mark'` (L19) first. A mark is validated with `navigationMarkSchema` (`lib/tracking/navigation-mark.ts`) and inserted into its own Postgres table, `page_timing` (`docs/migrations/030_page_timing.sql`). Without `kind` the same endpoint keeps storing page views in `page_tracking`; a mark never goes there.

```sql title="docs/migrations/030_page_timing.sql · L15–L26"
CREATE TABLE IF NOT EXISTS public.page_timing (
  id bigserial PRIMARY KEY,
  org_id text NOT NULL,
  user_id text NOT NULL,
  kind text NOT NULL,
  from_path text,
  path text NOT NULL,
  source text,
  elapsed_ms integer NOT NULL,
  client_timestamp timestamptz,
  server_timestamp timestamptz NOT NULL DEFAULT now()
);
```

The README's query, ready to paste on the read-only Postgres role. Add `AND org_id = '…'` for one client, or `AND path = '/product-analytics'` for one page.

```md title="docs/features/client-cache/README.md · L333–L342"
SELECT kind,
       path,
       coalesce(source, '—') AS source,
       count(*) AS marks,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY elapsed_ms)) AS p50_ms,
       round(percentile_cont(0.75) WITHIN GROUP (ORDER BY elapsed_ms)) AS p75_ms
FROM page_timing
WHERE server_timestamp > now() - interval '7 days'
GROUP BY kind, path, source
ORDER BY kind, path, source;
```

:::info[Why this way]

A separate table beat new columns on `page_tracking`: rows there count as visits for the warm-up's priority ([Warm-up](09-warm-up.md), ESC-752), and a mark is not a visit.

:::

## 5. `X-Cache` and `cacheOutcome`

The second question is asked of the server. Every API route that answers from a server cache stamps its response, 204 and 202 included, with a header named `X-Cache` holding one of three words. `hit`: everything came from the cache and is current. `partial`: the stored answer was served while a recalculation runs, or part came from the cache and part was computed (non-additive totals are two periods; Ads' `days` combines days and objects). `miss`: computed now, or nothing to answer. `cacheOutcome` derives the word from what each cache primitive reports: a `source` of `cache` or `computed`, and an `isStale` flag.

```ts title="lib/cache/x-cache.ts · L17–L24"
/** All from the cache and none stale → hit; all computed → miss; anything else → partial. */
export function cacheOutcome(
  answers: readonly { source: AnswerSource; isStale: boolean }[]
): CacheOutcome {
  if (answers.every((answer) => answer.source === 'cache' && !answer.isStale)) return 'hit';
  if (answers.every((answer) => answer.source === 'computed')) return 'miss';
  return 'partial';
}
```

Who sends it: every cache-backed route of the seven pages in the table above and the public reports under `/api/v1/reports`. A route outside that set has no server cache and sends no header. Absence means "not cached", never "miss".

:::info[Why this way]

Three words instead of a boolean, because stale-while-revalidate makes "from the cache" and "current" different facts. One pure function beat each route choosing its own string: the same inputs mean the same word everywhere.

:::

## 6. The `event: "cache"` log line

A header is visible in one browser's network tab; a log line is countable across every request. The helper that sets the header, `withCacheLog`, also writes one bare JSON object per answer: route, page identifier, org, outcome, HTTP status, milliseconds since the request started and `chQueries`, the warehouse queries that request ran.

```ts title="lib/server-functions/reporting/cache-log.ts · L19–L34"
export function withCacheLog<R extends Response>(response: R, log: CacheLog): R {
  response.headers.set(X_CACHE_HEADER, log.outcome);
  console.info(
    JSON.stringify({
      event: 'cache',
      route: log.route,
      surface: log.surface,
      orgId: log.orgId,
      cache: log.outcome,
      status: response.status,
      ms: Date.now() - log.startedAt,
      chQueries: log.chQueries,
    })
  );
  return response;
}
```

To read a hit rate: in the Vercel project's Logs, search `"event":"cache"`, group by `surface` and `cache`, filter by `orgId` for one client. The page identifiers are `dashboard`, `ads`, `product-analytics`, `ltv`, `inventory`, `customer-journey` and `monitoring`. The warm-up's `event: 'warmup'` line is a different event, owned by [Warm-up](09-warm-up.md).

:::info[Why this way]

A bare JSON object with no text prefix, because Vercel indexes its fields and lets you group on them. One line per answer rather than an in-memory counter, because a serverless function keeps nothing between invocations.

:::

## 7. `log_comment` from the query context

The third question is asked of ClickHouse. Every query through `queryData` carries the ClickHouse setting `log_comment`, shaped `app:::`, so the warehouse's own `system.query_log` can attribute load. Page and mode come from a query context: a small object an entry point places around its data call with `withQueryContext`, read back by every `queryData` reached from there through any number of `await`s, stored in Node's `AsyncLocalStorage`. The context also carries `queries.count`, incremented by `queryData` on every attempt (`lib/server-functions/database/clickhouse.ts` L104–L116) and reported as `chQueries`. The org comes from the context or, failing that, from the query's own parameters.

```ts title="lib/server-functions/database/query-context.ts · L42–L50"
export function formatLogComment(
  ctx: QueryContext | undefined,
  params: Record<string, unknown>
): string {
  const surface = ctx?.surface ?? 'unknown';
  const mode = ctx?.mode ?? 'unknown';
  const orgId = ctx?.orgId ?? orgIdFromParams(params) ?? '';
  return `app:${surface}:${mode}:${orgId}`;
}
```

| `mode` | Who sets it |
| --- | --- |
| `page` | A server render: the dashboard's live path and Blended (`app/blended/page.tsx`). |
| `api` | An API route answering the browser: every cache-backed route, plus `/api/pixel/analytics` (`monitoring`) and `/api/orders/latest` (`orders`). |
| `job` | Work after the response or a cron: snapshot refresh, range and day recalculations, non-additive totals, the org-marks check (`org-marks`), the warm-up tick (`warmup`). |
| `public-api` | `/api/v1` and the MCP, wrapped once in `withApiAuth` (`lib/api-v1/with-api-auth.ts` L209–L211); the page field is the catalog route, e.g. `v1/reports/dashboard`. |
| `unknown` | Nobody set a context. Not in the type; the first reading lists what is left to wrap. |

The README's query, on ClickHouse read-only. Per the README, `system.query_log` keeps about 2 h 15 min in production (the repo cannot verify this), so run it inside that window.

```md title="docs/features/client-cache/README.md · L376–L386"
SELECT splitByChar(':', log_comment)[2] AS surface,
       splitByChar(':', log_comment)[3] AS mode,
       count() AS queries,
       formatReadableSize(sum(read_bytes)) AS read,
       round(quantile(0.75)(query_duration_ms)) AS p75_ms
FROM clusterAllReplicas(default, system.query_log)
WHERE type = 'QueryFinish'
  AND event_time > now() - INTERVAL 2 HOUR
  AND startsWith(log_comment, 'app:')
GROUP BY surface, mode
ORDER BY sum(read_bytes) DESC;
```

:::info[Why this way]

A context in `AsyncLocalStorage` beat threading a "who is asking" argument through every reporting function: the chains are deep and shared, and one wrap at the entry point labels all of them. Defaulting to `unknown` instead of throwing keeps an unwrapped entry point working and makes the gap visible in the same query.

:::

:::warning[Gotcha]

Blended sets no org in its context on purpose (`app/blended/page.tsx` L150): each query carries the org of its own parameters. And the README lists Inventory's render under `page`, but the only `mode: 'page'` wraps are in the dashboard page and Blended; the Inventory render only peeks Postgres, so its ClickHouse queries are `api` or `job`.

:::

## Public API v1, MCP and Blended

Since ESC-756 the public reports (`/api/v1/reports/dashboard`, `/ads`, `/products`) and Blended read the same caches as the pages and compute live when the cache cannot answer. The MCP calls those routes in process and inherits this. For measurement: the three routes send `X-Cache` and the cache log line under `dashboard`, `ads` and `product-analytics`; their warehouse queries carry `app:v1/reports/:public-api:`; what they enqueue after the response runs as `app:dashboard:job:`. The five `customer-journey/*` reports do the same under `customer-journey`.

## What the branch did not change

- **Dashboard pop-ups stay paused.** `DASHBOARD_POPUPS_PAUSED` is `true` in `lib/dashboard/resolve-dashboard-popups.ts`. When they return, take them out of the `await` that blocks the page.
- **Nudges and Pixel presence** already stream, without blocking.
- **Monitoring's Klaviyo view** keeps its own queries, uncached.
- **None of the three measurements** changes what the user sees.

## Follow a request

1. **Browser** · Monday 10:00, the client's media buyer clicks "Productos". `SidebarLink` calls `startPageMark('/', '/product-analytics')`: one pending mark of kind `page`.
2. **Products client** · The page asks `/api/product-analytics/days`. When `numbersReady` turns true, `useNumbersReady` calls `endMark` with `sourceSince(active.dataUpdatedAt)`: `network`, the data arrived after the click.
3. **POST /api/tracking** · `recordMark` validates with `navigationMarkSchema` and inserts into `page_timing`: `kind = 'page'`, `path = '/product-analytics'`, `elapsed_ms = 1900`.
4. **Products API route** · Meanwhile `days` ran inside `withQueryContext({ surface: 'product-analytics', mode: 'api', orgId })`. Nothing current in the day cache, so `cacheOutcome` said `miss`; `withCacheLog` set `X-Cache: miss` and logged `{"event":"cache","surface":"product-analytics","cache":"miss",…}`.
5. **ClickHouse** · Each `queryData` in that chain sent `log_comment = app:product-analytics:api:` and bumped `queries.count`, reported as `chQueries`.
6. **Rodrigo, Postgres** · The p75 query with `AND org_id = …`: Products, `page`, `network`, p75 1900 ms. Confirmed.
7. **Rodrigo, Vercel Logs** · `"event":"cache"` filtered by that `orgId` and `product-analytics`: mostly `miss`.
8. **Rodrigo, ClickHouse** · The `system.query_log` query, inside the retention window: `product-analytics` / `api` near the top of bytes read. He opens [Products](04-products.md) and [Warm-up](09-warm-up.md) to ask why this org's days were not warm.

## Where to look

| Role | File |
| --- | --- |
| Pending mark, start/end, `sourceSince`, `useNumbersReady` | `lib/perf/navigation-marks.ts` |
| Sidebar click starts a `page` mark | `components/app/sidebar-section-context.tsx` |
| "Aplicar" starts a `range` mark | `components/ds/date-range-selector.tsx` |
| LTV window change starts a `range` mark | `components/ltv/select-window-days.tsx` |
| Mark schema, `MAX_MARK_MS` | `lib/tracking/navigation-mark.ts` |
| `MARK_DESTINATION_PATHS`, `pathForTracking` | `lib/tracking/tracked-paths.ts` |
| Endpoint: marks to `page_timing`, views to `page_tracking` | `app/api/tracking/route.ts` |
| `page_timing` table | `docs/migrations/030_page_timing.sql` |
| Inventory's mark end (the `html` gotcha) | `app/(app)/(analytics)/(advanced)/inventory/client.tsx` |
| `cacheOutcome`, `X_CACHE_HEADER` | `lib/cache/x-cache.ts` |
| `withCacheLog`: header plus log line | `lib/server-functions/reporting/cache-log.ts` |
| `withQueryContext`, `formatLogComment`, `QueryMode` | `lib/server-functions/database/query-context.ts` |
| `queryData`: reads the context, counts, sets `log_comment` | `lib/server-functions/database/clickhouse.ts` |
| `public-api` mode around v1 and MCP | `lib/api-v1/with-api-auth.ts` |
| Blended's context without org | `app/blended/page.tsx` |
| `DASHBOARD_POPUPS_PAUSED` | `lib/dashboard/resolve-dashboard-popups.ts` |
| Current behaviour, both SQL queries | `docs/features/client-cache/README.md` |

## Terms

- **navigation mark**: The one pending stopwatch a gesture starts and the destination's first numbers end (README: "marca de navegación").
- **`source`**: Where the numbers came from: `device`, `network`, `memory`, or the never-emitted `html`.
- **`page_timing`**: Postgres table, one row per mark; apart from `page_tracking` because a mark is not a visit.
- **`X-Cache`**: `hit`, `partial` or `miss`. Absent means "no server cache".
- **cache log line**: The bare JSON `{"event":"cache",…}` written once per answer.
- **surface**: The page identifier a route, a log line and a `log_comment` share (README: "superficie").
- **query context**: The `AsyncLocalStorage` object (`surface`, `mode`, `orgId`, query count) set by `withQueryContext`.
- **`mode`**: `page`, `api`, `job`, `public-api`; `unknown` when nobody set a context.
- **`log_comment`**: `app:::`, stamped on every `queryData` attempt.
