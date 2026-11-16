---
title: "The big picture"
sidebar_label: "1. The big picture"
sidebar_position: 1
description: "Where a number on a report page can come from, which place answers a given click, and the one rule every layer shares: a stored number is valid while its stamp matches the last writes to the data, never because a timer has not run out."
---

# The big picture

*After this chapter you can name the places a number on a report page can come from, say which one answers a given click, and state the one rule every layer shares: a stored number is valid while its stamp matches the last writes to the data, never because a timer has not run out.*

<small>~12 min · Built on: ESC-657, ESC-710, ESC-748 to ESC-757, docs/features/client-cache/README.md</small>

:::tip[In simple terms]

When a user opens a report page, the page needs two things: its structure (which sections exist, which controls, what this user may see) and the numbers for the period on screen (orders, revenue, ad spend, costs, profit, by day).

The structure is cheap. It comes from Postgres in a few milliseconds. The numbers are not: nothing stores them ready-made. They are calculated from the raw records in ClickHouse, the analytics database, and for a large store that calculation takes seconds and gets slower when many people ask at once. Before this branch, the server ran that calculation inside the page request, so the user saw nothing until the slowest query had finished.

The branch separates the two. The server sends the structure right away, with placeholders where the numbers go, and the browser then looks for the numbers in the closest place that has a valid copy:

1. **On the device.** The last numbers this browser saw, kept on disk. A refresh or a new tab paints them before any request leaves the phone.
2. **In the browser's memory.** Numbers already fetched in this session. Going back to a page, or changing the date range, costs nothing.
3. **In a server cache in Postgres.** The org's numbers, already calculated and stored one row per day. Any range is a sum of stored days.
4. **In ClickHouse**, only when nothing above has a valid copy. The result is stored so the next request does not pay again.

Every copy has to know whether it is still right, and none of them expires on a timer. Each one carries a stamp derived from the last time the underlying records were written. When a reprocess or a late order changes a day, that day's stamp changes, that day alone is recalculated, and the browser, which asks the server once a minute whether its stamp is still current, replaces what changed without reloading the page.

The rest of this chapter takes those pieces one at a time. The page chapters show how each page applies them.

:::

## 1. The live path, and why it needed a cap

The live path is the original way of answering: the server queries ClickHouse for the whole report inside the request. It still exists, because sometimes nothing cached can answer: a brand-new org, a range nobody has stored, a role that never receives rows. What changed is that it is now the last resort, and that even the caches' own recalculations run under one global limit, so a burst of requests after a reprocess cannot overload the database.

In the code, every number comes from ClickHouse: orders, ad spend, costs, email and pixel sessions, summed per day. The README calls this path the "camino en vivo". The limit is `MAX_CONCURRENT_RECALCULATIONS`, one ceiling shared by every org and by every cache in this chapter.

```ts title="lib/dashboard/snapshot/model.ts · L28–L32"
/**
 * How many recalculations can run at once across every org. A full one of the heaviest org reaches
 * 4,6 GiB against a 21 GiB server, so this keeps a burst from taking it down.
 */
export const MAX_CONCURRENT_RECALCULATIONS = 3;
```

:::info[Why this way]

One cap of 3 across every org, not one per org: the risk is memory on one shared server. Letting every stale read recalculate on its own would let a burst of tabs after a reprocess take it down.

:::

## 2. Rule B: the server ships structure, never numbers

The first decision is that the server never waits for numbers. The server code of a report page reads only what Postgres knows: permissions, sections, connected platforms and, at most, the state of the cache (a version and a date). The HTML carries that structure and nothing else. The browser fetches the numbers, or restores them from the device, and every component draws its own placeholder inside the real layout until it has them. Controls (dates, currency, filters, tabs) are always real, never placeholders.

In the code, this is what `page.tsx` of a report page does, and the README calls it rule B. `app/(app)/layout.tsx` wraps every page in a `Suspense` with `fallback={null}`: the sidebar and header stream first, and on a navigation the previous page stays until the next one has its frame. The opposite, rows in the HTML through a `HydrationBoundary`, is called seeding. It survives only behind `DASHBOARD_SEED_ROWS=1`, which `isSeedingEnabled()` ignores in production, so staging can compare both.

```tsx title="app/(app)/(analytics)/(dashboard)/page.tsx · L248–L260"
  // Rule B: the rows do not go in the page. `DASHBOARD_SEED_ROWS=1` (never in production) puts them
  // back in the query cache with the page, so staging can compare how a refresh feels with and
  // without them.
  let dehydratedRows: DehydratedState | null = null;
  if (answersInBrowser && cacheScope) {
    const rows = isSeedingEnabled() ? await readDashboardSnapshotRows(orgId, currency) : null;
    if (rows) {
      const seed = new QueryClient();
      seed.setQueryData(dashboardSnapshotKey(cacheScope, currency), rows);
      dehydratedRows = dehydrate(seed);
    }
    if (perf) after(() => perf.end());
  }
```

:::info[Why this way]

Seeding paints numbers first, but every request then pays the read and serialization of the rows. Rule B pays nothing on the server and gets the same instant paint from the device copy (section 6). The flag keeps the comparison repeatable instead of deleting the code.

:::

## 3. Marks: the last write per table, per day

If the server does not recalculate on every request, something has to say when a stored number went stale. That something is a mark: for one org, one table and one day, the time of the last write to that table for that day. A reprocess, a late order and an edited cost all rewrite rows, so they all move a mark. Nobody needs to know why a day changed, only that it did. Every cache in this chain compares its own stamp against the marks.

In the code, ClickHouse stamps every row with a write time, so a mark is one `max()` per day over the table's sort key, 3 to 10 ms per table on a small org. Twelve tables can be marked (`MARKED_TABLES`); a page declares which ones it reads. The marks travel with a `connectionsKey`, the sorted list of stores and accounts, because disconnecting a store changes a report without rewriting a single row.

```ts title="lib/server-functions/reporting/daily-marks.ts · L200–L212"
export async function getDailyMarks(
  orgId: string,
  startDate: string,
  endDate: string,
  { tables }: { tables?: readonly MarkedTable[] } = {}
): Promise<DailyMarks> {
  const { sources, params, connectionsKey } = await loadMarkScope(orgId, tables);
  const parts = sources.map(
    ({ table, day, writtenAt, scope }) =>
      `SELECT '${table}' AS t, toString(${day}) AS d, ${writtenAt} AS m
         FROM ${table} WHERE ${scope}
          AND ${day} >= {startDate:Date} AND ${day} <= {endDate:Date}
        GROUP BY ${day}`
```

:::info[Why this way]

The alternative was a timer: recalculate everything every N minutes. Marks are cheaper and exact. Their blind spot is a direct delete, which rewrites nothing; the hourly and daily intervals in `model.ts` exist for that. Timers remain, but only as ceilings.

:::

## 4. Two server caches: by day, and by range

Calculated numbers are stored in Postgres in one of two shapes. The per-day cache keeps a page's rows for each day of the last 125 days, each day stamped with the hash of its own marks. Any range inside that window is a sum of stored days, and a change to five days in October makes exactly those five stale. The per-range cache keeps one finished report per exact request, stamped with the marks of its whole range. It is for what days cannot express (cohort grids, unique customers) and for ranges older than the window. Both serve a stale entry immediately and recalculate it after answering, if one of the global slots is free. Both calculate a missing entry inside the request, once, however many tabs ask.

In the code, the dashboard keeps its own older copy of the per-day shape, the snapshot in `dashboard_snapshot` ([Dashboard](02-dashboard.md)); every other page uses `cachedDailyReport` over `surface_day_cache`, Ads first ([Ads](03-ads.md)). The per-range cache is `cachedRangeReport` over `surface_range_cache` ([LTV](05-ltv.md) is a page that lives on it). The window is `SNAPSHOT_WINDOW_DAYS`.

```ts title="lib/server-functions/reporting/cached-daily-report.ts · L374–L388"
/**
 * A surface's days over `[start, end]`, inside the window. Current days come from Postgres. Missing
 * ones are computed in the request, by spans, by whoever holds the key's lease; the rest wait for
 * it. Stale ones are served now and recomputed after the response if a global slot is free. A span
 * that fails keeps the lease, so asking again does not retry it, and leaves the stored days alone.
 * If the store itself fails, the days are computed live: the page must still answer.
 *
 * The marks are read before computing: a write during the calculation moves its mark past the
 * hash saved here, so the next read sees it.
 */
export async function cachedDailyReport<Day>(
  request: DailyReportRequest,
  calculation: DailyCalculation<Day>,
  now: number = Date.now()
): Promise<DailyReportAnswer<Day>> {
```

:::info[Why this way]

One cache per shape of data, not one per page. Days give range changes for free and recalculate only what moved; ranges pay a full recalculation each but hold what days cannot express. A store per page would have meant seven leases, seven caps and seven ways to be stale.

:::

## 5. The browser cache: one store per owner, refreshed by a version

Numbers that reach the browser are kept in one in-memory store for the whole app, owned by the current org, user and permission set. Switching org starts with an empty store; navigating inside the app keeps everything. Nothing in it expires on its own. Instead, the browser asks the server once a minute (every 10 seconds during a reprocess, and whenever the tab comes back) for the current version of each page's data. If the server's version is newer, the page fetches again, with the old numbers on screen until the new ones land.

In the code, the store is a TanStack `QueryClient` that `AppCacheProvider`, mounted by the `(app)` layout, creates with a React `key` equal to the cache scope. Every query of a cached page builds its key with `surfaceKey(id, scope, …)` from `lib/cache/surface.ts`: the surface first (a page's id plus the marked tables that can change it, a `CacheSurface`), then the owner, so invalidating a surface targets that prefix. Queries say `staleTime: Infinity`, and surface queries stay in memory two hours after last use (`SURFACE_GC_TIME_MS`) so what the [warm-up](09-warm-up.md) preloaded is still there on the click. `useSurfaceVersion` asks `/api/cache/versions`; the dashboard compares with `isSnapshotCurrent`: same `settingsKey` and a remote version not above its own. Anything else invalidates the surface.

```tsx title="components/dashboard/snapshot-dashboard-content.tsx · L83–L93, L148–L156"
  const snapshot = useQuery({
    queryKey: scope ? dashboardSnapshotKey(scope, currency) : ['surface', 'no-scope'],
    queryFn: () => fetchDashboardSnapshot(currency),
    enabled: scope !== null,
    staleTime: Infinity,
    gcTime: SURFACE_GC_TIME_MS,
    retry: retryUnlessBlocked,
    persister: persister
      ? persistUnlessPending(persister, { onAnswer: heard(setRowsFromDevice, currency) })
      : undefined,
  });
  …
  const remote = useSnapshotStatus(useSnapshotPollInterval(), currency);
  const refetchedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!remote || !data || isSnapshotCurrent(data, remote)) return;
    const remoteKey = `${remote.settingsKey ?? ''}|${remote.version}`;
    if (refetchedFor.current === remoteKey) return;
    refetchedFor.current = remoteKey;
    void queryClient.invalidateQueries({ queryKey: surfaceKeyPrefix(DASHBOARD_SURFACE.id) });
  }, [remote, data, queryClient]);
```

:::info[Why this way]

One client above every page is what makes coming back to a page instant. A `staleTime` of a few minutes would add its own delay on top of the server's; the version poll costs one tiny Postgres read with no numbers in it.

:::

## 6. The device copy: IndexedDB with a buster, a budget and a ceiling

Memory dies with the tab. So the queries that matter most also write every answer to the browser's on-disk storage and read it back when a page opens with nothing in memory: a refresh or a new tab paints last visit's numbers before any request, and the version check then confirms or replaces them. Three guards protect a copy: it is dropped if a different version of the code wrote it, it is evicted when the org's copies pass a size budget, and it is never used past 24 hours. Without that storage (a private window) the page simply runs on memory.

In the code, a query opts in by passing a `persister`. Today that is the dashboard rows and non-additive totals, the Ads days and the first page of the dashboard's latest orders; never a range report, never anything per person. The buster is `PERSIST_BUSTER`, the budget `PERSIST_BUDGET_BYTES` (20 MB per scope, least recently used evicted first) and the ceiling `PERSIST_MAX_AGE_MS`. Without IndexedDB every call fails inside its `catch`. One module, `lib/cache/persisted-cache.ts`, owns all of it.

```ts title="lib/cache/persisted-cache.ts · L23–L39"
/**
 * Bump by hand when what is stored changes shape: `DashboardSnapshotData`, `NonAdditiveTotals` or
 * the Ads days. 2 (ESC-752): the per-scope budget index arrived, with the Ads days.
 */
export const PERSIST_SCHEMA_VERSION = 2;
/**
 * ESC-752: what one scope may keep on the device. Past it, the least recently used copies go first,
 * never the one being written. The dashboard rows are ~20 KB; one platform's Ads days, several MB.
 */
export const PERSIST_BUDGET_BYTES = 20 * 1024 * 1024;
/** A ceiling, not an expiry: the version decides whether a copy is current, never this. */
export const PERSIST_MAX_AGE_MS = 24 * 60 * 60_000;
/**
 * Copies written by code that would read them differently are dropped on read. Not the build's sha:
 * a deploy that keeps the shape keeps the copies, and a deploy is when they help the most.
 */
export const PERSIST_BUSTER = `${PERSIST_SCHEMA_VERSION}|v${SNAPSHOT_CODE_VERSION}`;
```

:::info[Why this way]

The buster is not the build's sha. A deploy that keeps the shape keeps the copies, and a deploy is exactly when everyone reloads at once and the copies help most.

:::

## 7. The freshness state the header can show

Numbers restored from the device are on screen before the server has confirmed them. The page that owns them publishes their state (restored, being fetched again, or confirmed, plus when the server last checked them) so the header can show it next to the reprocess indicator. Today the header shows nothing for it; see the gotcha below.

In the code, the state is a `SurfaceFreshness` published through `useSetSurfaceFreshness()`, cleared on unmount and `null` outside `(app)`. The header's pill, `JobStatus`, is where it is meant to show, under any open reprocess job, which always wins.

```tsx title="components/providers/app-cache-provider.tsx · L25–L33"
/**
 * How current the numbers on screen are, for the header to say. `restored`: they came from the
 * device and the server has not confirmed them yet. `refetching`: newer ones are on their way.
 * `checkedAtMs` is the server's last check of them, not their last change.
 */
export type SurfaceFreshness = {
  checkedAtMs: number | null;
  state: 'confirmed' | 'restored' | 'refetching';
};
```

:::info[Why this way]

The page publishes and the header reads, through context, instead of the header inspecting the query cache: the header does not know which query holds the numbers on screen; the page does.

:::

:::warning[Gotcha]

The README's "Aviso de frescura" says that with no open job `JobStatus` shows "Actualizando" and "Actualizado hace X". The code wins: `components/jobs/job-status.tsx` hides that text since 2026-11-11 (Mateo), because next to the reprocess pill it read as the same thing. Pages still publish the state; it returns with task 1.13 of the plan. Also, the older lesson `docs/personal/teach/esc-710-cache-pipeline/lessons/0001-the-map.html` predates the per-day cache; the table below is the current one.

:::

## The six places, in one table

| Place | Keyed by | Still right while |
| --- | --- | --- |
| ClickHouse, the source | org, store, account | Always; every mark is read here |
| Per-day cache (`dashboard_snapshot`, `surface_day_cache`) | org, surface, params hash, day | Each day's marks hash matches; hourly ceiling for unmarked sources |
| Per-range cache (`surface_range_cache`, the dashboard's non-additive totals) | org, surface, sha256 of the request | The range's marks hash matches; 1 h ceiling unless every source is marked |
| The page's HTML | this request | Live path, Limited role or seeding only; never cached |
| Browser memory, `QueryClient` | `['surface', id, org, user, perms, …]` | Until the version poll says otherwise; gone 2 h after last use |
| The device, IndexedDB | `escalafy-cache:<scope hash>-<query hash>` | Same buster, under 24 h, then confirmed by the version |

## The recipe for a new page

The README's ten steps; each chapter named applied that step.

| Step | See |
| --- | --- |
| 1. Per-day or per-range; list the tables that change the page | [Ads](03-ads.md), [LTV](05-ltv.md) |
| 2. Add those tables to the marks, measuring the read first | [Ads](03-ads.md), [Products](04-products.md) |
| 3. Wrap the existing function, same return value | [Products](04-products.md) |
| 4. API route: `assertOrgAccess`, its surface, `X-Cache` and log line | [Measuring it](10-measuring.md) |
| 5. Thin `page.tsx`: no report await, no seeding | [Dashboard](02-dashboard.md) |
| 6. `useQuery` with the surface key, persister and navigation mark | [Dashboard](02-dashboard.md), [Measuring it](10-measuring.md) |
| 7. `useSurfaceVersion` and an entry in `/api/cache/versions` | [Dashboard](02-dashboard.md) |
| 8. `useInvalidateAfterSave` on the saves that affect it | [Dashboard](02-dashboard.md) |
| 9. Skeletons per element; delete `loading.tsx` | [Inventory](06-inventory.md), [Monitoring](08-monitoring.md) |
| 10. Shadow-compare against live, then activate for every org | [Measuring it](10-measuring.md) |

## Follow a request

A user with full report permissions refreshes the dashboard. The device holds a copy from the previous evening, and one day has changed on the server since then.

1. **Browser** · GET /. `app/(app)/layout.tsx` runs `auth()` and `getCacheScope()`, schedules `warmupTick` with `after()`, and renders `AppCacheProvider` keyed by the scope. Sidebar and header stream first.
2. **Server, page.tsx** · `readDashboardSnapshotStatus` returns two columns, so `answersInBrowser` is true. No rows are read; the HTML carries sections, permissions and controls. `after()` schedules `refreshDashboardSnapshot`.
3. **Browser** · `SnapshotDashboardContent` mounts its query with no data. `persistUnlessPending` finds the copy: same `PERSIST_BUSTER`, a few hours old. The rows restore, freshness publishes `restored`, the numbers paint. `sweepPersistedCache` drops every other scope's copies on this device.
4. **Browser → Postgres** · `useSnapshotStatus` polls `/api/cache/versions`. The route answers from the status columns at once and, if a check is due, schedules the refresh with `after()`: it reads `getDailyMarks`, sees that one day's mark moved, and recalculates that day alone under the global cap.
5. **Browser** · `isSnapshotCurrent(data, remote)` is false. `invalidateQueries` on the surface prefix refetches `/api/dashboard/snapshot`, which reads `dashboard_snapshot`, never ClickHouse. The rows swap in place, the persister writes the copy, freshness becomes `confirmed`.
6. **Browser** · The user picks Last 30 days: `resolveLocalRange` takes the URL's range and the component sums the rows it has. No request leaves the device.
7. **Browser → Postgres** · The user picks Last year: `isRangeCovered` is false, so the report shows its skeleton and `/api/dashboard/range-report` answers from `cachedRangeReport`. The answer stays in memory, never on the device.
8. **Header** · `JobStatus` finds no open job and renders nothing: the freshness text is hidden today (see the gotcha).

## Where to look

| Role | File |
| --- | --- |
| Current behaviour; the recipe | `docs/features/client-cache/README.md` |
| Vocabulary | `docs/features/client-cache/GLOSSARY.md` |
| Why the cache exists | `docs/performance/plan-cache-integral.md` |
| Window, intervals, global cap | `lib/dashboard/snapshot/model.ts` |
| Rule B in practice | `app/(app)/(analytics)/(dashboard)/page.tsx` |
| The seeding flag | `lib/dashboard/snapshot/seed-flag.ts` |
| The one cache; `Suspense` with no fallback | `app/(app)/layout.tsx` |
| Marked tables | `lib/server-functions/reporting/daily-marks.ts` |
| Per-day cache | `lib/server-functions/reporting/cached-daily-report.ts` |
| Per-range cache | `lib/server-functions/reporting/cached-range-report.ts` |
| Surfaces, scope, keys | `lib/cache/surface.ts` |
| Scoped `QueryClient`, freshness | `components/providers/app-cache-provider.tsx` |
| Dashboard queries, version check | `components/dashboard/snapshot-dashboard-content.tsx` |
| Version poll | `lib/cache/use-cache-versions.ts` |
| Poll interval | `components/dashboard/use-snapshot-refresh.ts` |
| IndexedDB | `lib/cache/persisted-cache.ts` |
| Header pill | `components/jobs/job-status.tsx` |
| Older map | `docs/personal/teach/esc-710-cache-pipeline/lessons/0001-the-map.html` |

## Terms

- **live path**: The server calculating against ClickHouse because nothing cached can answer. (README: "camino en vivo")
- **rule B**: The HTML carries structure and cache state, never numbers. (README: "Regla B")
- **seeding**: Rows in the HTML through a `HydrationBoundary`; staging only. (README: "siembra")
- **skeleton**: What stands in for a number while it loads, inside the real structure.
- **mark**: For one org, table and day: the time of the last write. (README: "marca")
- **per-day / per-range cache**: Rows per day summed for any range; or one finished report per request. (README: "caché por día", "caché por rango")
- **global cap**: `MAX_CONCURRENT_RECALCULATIONS`: 3 at once across every org and cache. (README: "tope global")
- **surface (`CacheSurface`)**: One page's cached data: its id and the tables that can change it. (README: "superficie")
- **scope (`CacheScope`)**: Org, user and permissions: the owner at the start of every key.
- **version / `settingsKey`**: The counter the browser compares to; a new settings key starts it at 0.
- **device copy / buster**: A query's copy in IndexedDB; `PERSIST_BUSTER` says which code wrote it. (README: "copia del dispositivo")
- **restored / confirmed**: From the device, unvouched; or checked by the server in this load.
- **Limited role**: A reader who never receives rows; the server sums for them. (README: "rol Limited")
