---
title: "Dashboard"
sidebar_label: "2. Dashboard"
sidebar_position: 2
description: "After this chapter you can say, for any range a user picks on the dashboard, whether the browser answers it alone, whether the server sends one whole report, and which tiles arrive a moment later. You can also read the header pill and know why it says what it says."
---

# Dashboard

*After this chapter you can say, for any range a user picks on the dashboard, whether the browser answers it alone, whether the server sends one whole report, and which tiles arrive a moment later. You can also read the header pill and know why it says what it says.*

<small>~9 minBuilt on: ESC-710, ESC-748, ESC-751, ESC-759, docs/features/client-cache/README.md</small>

:::tip[In plain words]

Ana opens the dashboard on 2026-11-16 at 9:00, on her phone. The page appears at once with its sections, the selector on "Last 7 days" and the numbers of her last visit already in the tiles. The header says "Updating". A second later it says "Updated 3 min ago" and no tile moves: the numbers were right. Two tiles, pixel users and LTV, were grey for that second and then filled in.

She picks "Last 60 days". The address bar changes, the tiles change, nothing loads. The browser already had every day it needed and added them up on the spot; the pixel and LTV tiles took one short request, because they cannot be added that way.

Then she picks "This year". The report becomes a skeleton for a couple of seconds and lands whole: that range reaches back to January, further than the daily numbers the browser holds, so the server answered it from its stored copy of that exact range. Picking "This year" again in the same tab is instant. After an F5 the daily numbers come back from her phone before the network answers; the year report does not. A colleague with the Limited role sees none of this: every range change asks the server for the page.

:::

## 1. The snapshot: one org's daily numbers, under one key

The dashboard keeps, per org and currency, one stored row with the base metrics of every day in a 125-day window ending tomorrow (`SNAPSHOT_WINDOW_DAYS`). That row is the **snapshot**: Postgres table `dashboard_snapshot`, gzipped, with a `version` that rises only when some day's numbers changed beyond a relative 1e-10 (`rowDifferences`), so float noise never moves it. The third part of its key is the **`settingsKey`**: code version plus the org's FX settings. Changing either leaves no trace in any ClickHouse row, so instead of invalidating it makes every read look for a row that does not exist yet.

```ts title="lib/server-functions/reporting/snapshot/snapshot-refresh.ts · L53–L60"
export async function snapshotKey(orgId: string, currency: string): Promise<SnapshotKey> {
  const [fx] = await getOrgFxGroups([orgId]);
  return {
    orgId,
    currency,
    settingsKey: `v${SNAPSHOT_CODE_VERSION}|${fx.preferredArs}|${fx.dollarFee}`,
  };
}
```

`refreshDashboardSnapshot`, scheduled in `after()` by every reader of the page, keeps it current under one lease per key every 5 minutes. The first build makes the recent 70 days (`RECENT_WINDOW_DAYS`) and the older 55 on the next check, which is why a snapshot knows whether it `hasOlderPart`.

:::info[Why this way]

Days, not ranges: one row answers every preset inside the window as a sum. FX settings in the key beat a settings-change hook: no event to miss, and a new key starts at version 0, which is also why a version from another key never counts as newer.

:::

## 2. The page asks only whether a snapshot exists

The server component never reads the rows. `readDashboardSnapshotStatus` reads two columns and applies `isSnapshotUsable`: built, and checked within 24 h. If that holds and the viewer is a full reader with a cache scope, the page sets **`answersInBrowser`** and ships the structure without one number. Otherwise it draws the report on the server: from the snapshot if the range is covered, live if not.

```tsx title="app/(app)/(analytics)/(dashboard)/page.tsx · L171–L179"
  const cacheScope = await getCacheScope();
  const canAnswerInBrowser = !isLimited && cacheScope !== null;
  const snapshotStatus = canAnswerInBrowser
    ? await readDashboardSnapshotStatus(orgId, currency)
    : null;
  const answersInBrowser = snapshotStatus !== null;
  const snapshotReport = answersInBrowser
    ? null
    : await readDashboardSnapshotReport(orgId, currency, start, end);
```

The decision ignores the range: "Last 7 days" and "This year" both answer in the browser. The Limited role is excluded here and again at the API, where `authorizeSnapshotReader` answers it 403: the rows carry base metrics that role must not see.

:::info[Why this way]

Rule B of [chapter 1](01-the-big-picture.md): the HTML never waits for numbers. Hydrating the rows into the page exists only behind `DASHBOARD_SEED_ROWS=1`, on staging.

:::

## 3. Which ranges the rows can answer

Every tile shows a trend against the previous period of equal length, so a range is **covered** only when it and its previous period both fit what the snapshot holds: the whole window once the older part is built, the recent 70 days until then. On 2026-11-16 the window is 2026-07-15 → 2026-11-17 and the recent part starts 2026-09-08. "Last 60 days" (2026-09-18 → 2026-11-16, previous period from 2026-07-20) is covered with the older part and not without it. "This year" has a previous period starting in February 2025: never covered.

```ts title="lib/dashboard/snapshot/model.ts · L107–L116"
/** What a stored snapshot can answer: the older part arrives after the recent one. */
export function snapshotCoverage(now: number, hasOlderPart: boolean): SnapshotWindow {
  return hasOlderPart ? snapshotWindow(now) : recentWindow(now);
}

/** Whether a range and the period its trends compare to are both inside the window. */
export function isRangeCovered(window: SnapshotWindow, start: string, end: string): boolean {
  const previous = getPreviousPeriod(start, end);
  return previous.start >= window.start && end <= window.end && start <= end;
}
```

`SnapshotDashboardContent` holds the rows in one TanStack query (`staleTime: Infinity`) and runs this check on every render. Covered: `buildSnapshotReport(rows, start, end)` in a `useMemo`, no request.

:::info[Why this way]

The same pure function runs on the server for the Limited role and in the browser for everyone else, so the two paths cannot disagree. Checking per render beat a server flag: the answer changes when the older part lands.

:::

## 4. A range change rewrites the URL, not the page

The frame (`DashboardView` in `client.tsx`) owns the selector. With `answersInBrowser`, picking a range calls `window.history.pushState` with the new `?start&end` and nothing else: no server round trip. The frame reads the range back from `useSearchParams` through `resolveLocalRange`, which only validates the two dates. Any range, however long, goes this way.

```tsx title="app/(app)/(analytics)/(dashboard)/client.tsx · L83–L90"
  const navigateToRange = (href: string) => {
    const params = new URLSearchParams(href);
    const range = answersInBrowser
      ? resolveLocalRange(params.get('start'), params.get('end'), { start: '', end: '' })
      : null;
    if (range?.start) window.history.pushState(null, '', href);
    else startRangeChange(() => router.push(href, { scroll: false }));
  };
```

The currency selector does the same: a preference and a new query key, no refresh (`onCurrencyChanged={keepPage}`). The `router.push` branch is what the Limited role and a page with no snapshot still use.

:::info[Why this way]

`router.push` would ask Next for a page the server has nothing to add to. `pushState` keeps the URL shareable and the back button working, and routing every range through it leaves one place to decide who answers.

:::

## 5. Ranges the rows do not reach: the range cache

A range that is not covered is answered whole by the second server cache of [chapter 1](01-the-big-picture.md), `surface_range_cache`, through `/api/dashboard/range-report`. The route wraps the live report in `cachedRangeReport` with currency, range and the snapshot's `settingsKey` as the entry's parameters, so an FX change is a new entry. A valid entry answers from Postgres. A stale one (marks moved, or older than one hour) is answered as is with `isStale: true` and recalculated after the response. A missing one is computed in the request; a second asker gets 202.

```ts title="app/api/dashboard/range-report/route.ts · L72–L96"
    if (!status?.hasSnapshot) return answer(new NextResponse(null, { status: 204 }), 'miss');

    // Read first: a version older than the data only costs one more read.
    const marksStatus = await readOrgMarksStatus(orgId).catch(() => null);
    const cached = await cachedRangeReport<DashboardReport>({
      surface: DASHBOARD_SURFACE.id,
      orgId,
      params: { currency, start, end, settingsKey: key.settingsKey },
      sources: DASHBOARD_SURFACE.sources,
      start,
      end,
      compute: () => startDashboardReport(orgId, currency, start, end).full,
      // A source that failed (pixel, email, LTV, previous period) reads "—": shown, never stored.
      isStorable: (report) => !report.failedSources?.length,
    });
    const body: DashboardRangeReport = {
      report: cached.data,
      isStale: cached.isStale,
      version: marksStatus ? surfaceVersion(DASHBOARD_SURFACE, marksStatus) : 0,
    };
    return answer(NextResponse.json(body), cacheOutcome([cached]));
  } catch (error) {
    // Someone else is calculating it: not a failure, and worth asking again.
    if (error instanceof RangeReportPendingError) {
      return answer(NextResponse.json({ pending: true }, { status: 202 }), 'miss');
```

In the browser this is a second query, enabled only while the rows do not cover the range. Its fetcher retries a 202 every 3 s up to 20 times, and the query polls every 3 s (`RECALCULATING_POLL_MS`) while the answer says `isStale`. A 204 means the snapshot went away and the page goes live. The body's `version` is the org marks' version for the dashboard's tables; the versions poll returns it as `rangeVersion`, and a higher one invalidates every range report of the scope. A range starting before the window, like "This year", is validated by the **older marks**: one coarse mark per table for all days before the window, refreshed at most hourly.

:::info[Why this way]

Widening the snapshot to a year would make every hourly recalculation a year heavy, for ranges few people pick. Finished reports per range cost one ClickHouse pass per hour at most, only for ranges someone asked. Older marks over-invalidate and never under-invalidate; that beat per-day marks for all history.

:::

## 6. Totals that cannot be summed

Pixel users, new pixel users and the LTV metrics (`NON_ADDITIVE_METRIC_IDS`, plus the calculated metrics that read them) are distinct counts: a visitor seen on Monday and Tuesday is one user for the two days, not two. So the rows do not add them. Each range of two days or more has its own stored total in `dashboard_snapshot_range`, keyed by org, currency, `settingsKey` and the exact `(start, end)`, valid for one snapshot version. `/api/dashboard/non-additive` answers the range and its previous period, for ranges inside the window only.

```ts title="lib/server-functions/reporting/snapshot/non-additive-totals.ts · L117–L146"
  const cached = await readRangeTotals(key, start, end);
  if (
    cached &&
    cached.snapshotVersion === snapshotVersion &&
    isFresh(end, cached.computedAtMs, now)
  ) {
    return { totals: cached.totals, isStale: false, source: 'cache' };
  }

  const isOurTurn = await claimRangeTotals(key, start, end);
  if (cached) {
    if (isOurTurn) {
      after(() => … calculateAndSave(key, snapshotVersion, start, end) …);
    }
    return { totals: cached.totals, isStale: true, source: 'cache' };
  }
  return {
    totals: isOurTurn
      ? await calculateAndSave(key, snapshotVersion, start, end)
      : await waitForTotals(key, start, end),
    isStale: false,
    source: 'computed',
  };
}
```

Two rules keep this request off the common path. **One day** (`isSingleDay`): within a day nothing is counted twice, so the total is that day's row and the browser asks nothing. **Preset warm-up**: after each check that found a snapshot, `warmPresetTotals` stores the missing pairs of the viewer's presets (last 7, 14, 30, 60 days, this month, last month, each with its previous period: `presetPairs`), under one global slot and a budget of `PRESET_WARMUP_BUDGET_MS` = 8 s counted from the start of the request that scheduled it, because Vercel's 15 s limit counts from there and not from `after()`. Past the budget the next check stores the rest. The viewer's day comes from the `user_tz` cookie, read before `after()`, which has no cookies. [Chapter 9](09-warm-up.md) covers the tick that shares this budget.

:::info[Why this way]

One snapshot version per stored total makes a reprocess invalidate every range at once with no bookkeeping. Warming the presets beat a bigger snapshot payload: a dozen pairs cover almost every click, and `deleteOldRangeTotals` drops an unused one after 7 days.

:::

## 7. The device copy and the pill

The rows (one entry per currency) and the totals (one per currency and range) pass a `persister`: each answer goes to IndexedDB, and a query that mounts empty restores its copy first. The range report passes none and lives in memory only. What is specific here is how a restored copy is confirmed. Rows carry `settingsKey` and `version`, so they wait for the versions poll (`useSnapshotStatus`: every 60 s with the tab visible, 10 s during a reprocess) and `isSnapshotCurrent` decides: same key and no higher remote version, they stand; anything else refetches with the old numbers still on screen. Restored totals have no version of their own, so they refetch at once (`refetchOnRestore: true`).

```tsx title="components/dashboard/snapshot-dashboard-content.tsx · L168–L182"
  const setFreshness = useSetSurfaceFreshness();
  const hasNumbers = data !== null || rangeData !== null;
  const isUnconfirmed =
    (rowsFromDevice === currency && remote === null) || totalsFromDevice === liveKey;
  const freshnessState =
    (snapshot.isFetching && stored !== null) || (range.isFetching && rangeData !== null)
      ? 'refetching'
      : isUnconfirmed
        ? 'restored'
        : 'confirmed';
  const checkedAtMs = remote?.checkedAtMs ?? data?.checkedAtMs ?? null;
  useEffect(() => {
    setFreshness(hasNumbers ? { checkedAtMs, state: freshnessState } : null);
  }, [hasNumbers, checkedAtMs, freshnessState, setFreshness]);
  useEffect(() => () => setFreshness(null), [setFreshness]);
```

`JobStatus`, with no open reprocess, shows `restored` and `refetching` as "Actualizando" and `confirmed` as "Actualizado hace {time}", counted from the server's last check, not from the last change of a number.

:::info[Why this way]

Last night's numbers before the network answers beat a skeleton on every F5: they are almost always right, and the pill says when they are not yet confirmed. The range report stays off the disk for size: a year of it is about 2.5 MB of JSON.

:::

:::warning[Gotcha]

The README's user-facing summary says a range of "more than 60 days" goes to the range cache. The code's rule is `isRangeCovered`: a 62-day range ending today still fits with its previous period, and "Last 60 days" is not covered until the older part exists. Predict with the function, not the number.

:::

:::warning[Gotcha]

The teach lessons under `docs/personal/teach/esc-710-cache-pipeline` predate ESC-751 and ESC-759: they say every covered range asks for its totals, on the click. Today a single day asks nothing and the presets are warmed ahead of it, within 8 s. The README and the code win.

:::

## What is different on this page

- **Its own daily snapshot, not the per-day cache.** The first page on the pattern still stores its days in `dashboard_snapshot`; every later page uses the per-day cache of [chapter 3](03-ads.md). Moving it is ESC-769, pending.
- **Two versions.** Rows follow the snapshot's `version` within a `settingsKey`; range reports follow `rangeVersion`, the org marks of the dashboard's six tables.
- **The Limited role stays on the server.** Its hidden metrics are base metrics of the rows; `useSnapshotRefresh` re-reads its page when the version moves.
- **Non-additive totals per exact range.** No other page has distinct counts that day sums get wrong.
- **The range report is memory only.** Rows and totals go to IndexedDB; the whole report does not.

## Follow a request

1. **Server component** · 9:00, `page.tsx`: saved range Last 7 days; `readDashboardSnapshotStatus` → version 41, checked 3 min ago. `answersInBrowser` is true; the HTML has no numbers. `refreshDashboardSnapshot` is scheduled in `after()`.
2. **Browser** · `SnapshotDashboardContent` mounts the rows query; the persister restores last night's copy and the tiles paint from it, pill "Actualizando". `/api/dashboard/snapshot` returns the 125 rows, version 41, `hasOlderPart: true`: identical to the copy.
3. **API route** · `/api/dashboard/non-additive` for the range and its previous week: both pairs were stored at version 41 by the last check's `warmPresetTotals`. The pixel and LTV tiles fill in through the report patch.
4. **Browser** · `useSnapshotStatus` gets `{ version: 41, settingsKey, checkedAtMs, rangeVersion }`; `isSnapshotCurrent` is true and the pill turns to "Actualizado hace 3 min".
5. **Browser** · "Last 60 days": `navigateToRange` calls `pushState`; `isRangeCovered` is true (2026-09-18 → 2026-11-16, previous period from 2026-07-20, window from 2026-07-15). `buildSnapshotReport` runs from memory; the totals query for the new pair hits the warmed total.
6. **API route** · "This year" (2026-01-01 → 2026-11-16) is not covered: the skeleton shows and `fetchDashboardRangeReport` calls `/api/dashboard/range-report`. `cachedRangeReport` finds no entry, computes `startDashboardReport(...).full` in the request and stores it with the org's marks hash, older marks included.
7. **Browser** · The report replaces the skeleton and stays in memory: "This year" again is instant until `rangeVersion` rises. Back on "Last 7 days", the rows query is still there and the tiles switch with no request.

## Where to look

| Role | File |
| --- | --- |
| Window, coverage, usability, version rule, budget | `lib/dashboard/snapshot/model.ts` |
| Report from rows; single-day rule | `lib/dashboard/snapshot/report.ts` |
| Browser query keys and fetchers | `lib/dashboard/snapshot/surface.ts` |
| Who may read the rows from a route | `lib/dashboard/snapshot/authorize-reader.ts` |
| The warmed presets | `lib/dashboard/snapshot/preset-pairs.ts` |
| The non-additive metric list | `lib/metrics/report-totals.ts` |
| Key, lease, check, recalculation, version bump | `lib/server-functions/reporting/snapshot/snapshot-refresh.ts` |
| Postgres statements | `lib/server-functions/reporting/snapshot/snapshot-store.ts` |
| Status, rows and server-drawn report readers | `lib/server-functions/reporting/snapshot/dashboard-snapshot.ts` |
| Per-range totals | `lib/server-functions/reporting/snapshot/non-additive-totals.ts` |
| Preset warm-up loop | `lib/server-functions/reporting/snapshot/preset-totals.ts` |
| Server component | `app/(app)/(analytics)/(dashboard)/page.tsx` |
| Frame: range and currency without the server | `app/(app)/(analytics)/(dashboard)/client.tsx` |
| Content: the three queries, the pill state | `components/dashboard/snapshot-dashboard-content.tsx` |
| Version poll and its interval | `components/dashboard/use-snapshot-status.ts`, `components/dashboard/use-snapshot-refresh.ts` |
| The pill itself | `components/jobs/job-status.tsx` |
| Rows, totals and whole-report routes | `app/api/dashboard/snapshot/route.ts`, `app/api/dashboard/non-additive/route.ts`, `app/api/dashboard/range-report/route.ts` |
| Versions poll | `app/api/cache/versions/route.ts` |
| Invalidating the surface after a save | `lib/cache/use-invalidate-after-save.ts` |
| Current behaviour, in Spanish | `docs/features/client-cache/README.md` |

## Terms

- **`snapshot`**: One org's base metrics per day for the 125-day window, per currency and settings key.
- **`settingsKey`**: `v{SNAPSHOT_CODE_VERSION}|{preferredArs}|{dollarFee}`: the sequence a version counts in.
- **`hasOlderPart`**: Whether the rows reach past the recent 70 days.
- **covered range**: A range whose previous period also fits the coverage (`isRangeCovered`).
- **`answersInBrowser`**: A full reader with a usable snapshot sums the rows in the browser, for any range.
- **range cache (README: "caché por rango")**: Whole reports per exact range in `surface_range_cache`.
- **`rangeVersion`**: The org marks' version for the dashboard's tables; what range reports compare.
- **older marks (README: "marca gruesa")**: One coarse mark per table for every day before the window.
- **non-additive totals (README: "totales no sumables")**: Pixel users and LTV for an exact range, in `dashboard_snapshot_range`.
- **single-day rule**: A one-day range takes its totals from that day's row (`isSingleDay`).
- **preset warm-up**: `warmPresetTotals`: the missing preset pairs stored after a check, within the budget.
- **device copy (README: "persistencia en el dispositivo")**: The IndexedDB copy of the rows and the totals; never the range report.
- **freshness pill (README: "aviso de frescura")**: `restored` / `refetching` ("Actualizando") or `confirmed`.
