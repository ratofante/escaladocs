---
title: "Warm-up"
sidebar_label: "9. Warm-up"
sidebar_position: 9
description: "After this chapter you can predict how long a cold org takes to get its cached pages ready, which pages get ready and for whom, and why a page you have never opened in this session can still draw without a request. You can also tell, from one row and one log line, where a warm-up stands."
---

# Warm-up

*After this chapter you can predict how long a cold org takes to get its cached pages ready, which pages get ready and for whom, and why a page you have never opened in this session can still draw without a request. You can also tell, from one row and one log line, where a warm-up stands.*

<small>~12 minBuilt on: ESC-752, ESC-753, ESC-754, ESC-755, ESC-756, docs/features/client-cache/README.md</small>

:::tip[In plain words]

Ana works at a store nobody has opened in Escalafy since Friday. On Sunday 2026-11-16 at 9:00 she opens Settings to check a shipping cost. She has no intention of looking at numbers. The server notices the visit anyway: right after it answers her page, it starts bringing the store's dashboard up to date for the last 125 days, in her currency. It works for about eight seconds and then stops, writing down where it got to.

Her browser also notices. Once her Settings page has painted and the tab is idle, it quietly asks the server "do you already have the dashboard? the Ads days for Meta? for Google?". At 9:00 the answers are "not yet". It asks again twenty seconds later, and from then on once a minute.

At 9:00:30 her colleague Bruno opens the Ads page in the same store. His visit buys the server another eight seconds, and his page keeps checking in every minute, which buys more. By 9:02 the server has finished: dashboard and both Ads platforms are ready. Ana's tab, still on Settings, picks up each piece as it appears: the dashboard at 9:00:23, Meta at 9:01:23, Google at 9:02:23. Nothing was computed for her tab; it only copied what the server already had.

At 9:04 Ana taps Dashboard. The numbers are already in her tab. The page draws them with no request at all, and only then starts checking whether anything changed.

:::

## 1. The tick: a bounded unit of work

A warm-up never runs as one long job. It runs as ticks. A tick is one call of `warmupTick` that walks the org's list of warmers in order, one at a time, and starts a new warmer only while it is under its budget: `WARMUP_TICK_BUDGET_MS`, 8 seconds, counted from the moment the tick won its turn. A warmer that has started finishes even if the budget runs out under it. When the tick stops early it records the index of the warmer it did not reach, so the next tick resumes there instead of starting over. Only the tick that ran the last warmer marks the run as complete. Every tick ends with one log line, `event: 'warmup'`, carrying its own counts and why it stopped; the run's totals, added up over its ticks, live in a row (next mechanism). [Measuring it](10-measuring.md) reads both.

```ts title="lib/server-functions/warmup/warmup-tick.ts · L78–L126 (trimmed)"
      for (; index < warmers.length; index++) {
        if (Date.now() - startedAt >= WARMUP_TICK_BUDGET_MS) {
          stoppedBy = 'budget';
          break;
        }
        const warmer = warmers[index];
        try {
          const outcome = await warmer.run();
          tick.keys += 1;
          tick.daysHit += outcome.daysHit;
          tick.daysComputed += outcome.daysComputed;
          tick.wholeKeysComputed += outcome.wholeKeysComputed ?? 0;
          run.warmers[warmer.id] = outcome;
        } catch (error) {
          if (error instanceof DailyReportPendingError) {
            stoppedBy = 'cap';
            break;
          }
          if (isClickHouseLoad(error)) {
            stoppedBy = 'clickhouse_load';
            break;
          }
…
    const nextIndex = finished ? 0 : index;
```

:::info[Why this way]

The tick runs inside `after()` of a page or a poll, and a Vercel function dies at 15 s counted from the request's start. One job that warms everything would be killed on any org with a few platforms and lose its progress. A budget plus a resume index makes progress survive: each visit buys eight seconds, and the visits add up. A cron was the alternative, but crons run only on production and this had to be verifiable on staging.

:::

## 2. One tick per org: the lease

Ten tabs loading at once must not start ten ticks. Each org has one row in `org_warmup` (migration `032_org_warmup.sql`), with four fields: `claimed_at` (who is ticking now), `finished_at` (when the last complete run ended, NULL while a run is incomplete), `next_index` (where the next tick starts) and `summary` (the run's totals). `claimWarmupTick` takes the turn with a single `INSERT … ON CONFLICT`: it succeeds only when nobody holds the lease for the last 20 s (`WARMUP_TICK_LEASE_MS`) and no run completed in the last 5 minutes (`WARMUP_RUN_INTERVAL_MS`). An org never warmed before has no row, so the insert itself takes the turn. Everyone else gets no row back and does nothing. `saveWarmupTick` hands the lease back, stores `next_index` and the summary, and sets `finished_at` only when the run completed.

```ts title="lib/server-functions/warmup/warmup-store.ts · L38–L48"
  const rows = await execute_transaction(
    `INSERT INTO org_warmup AS w (organization_id, claimed_at)
     VALUES ($1, now())
     ON CONFLICT (organization_id) DO UPDATE
       SET claimed_at = now()
       WHERE (w.claimed_at IS NULL OR w.claimed_at < now() - ${ms('$2')})
         AND (w.finished_at IS NULL OR w.finished_at < now() - ${ms('$3')})
     RETURNING w.next_index, w.summary`,
    [orgId, WARMUP_TICK_LEASE_MS, WARMUP_RUN_INTERVAL_MS],
    ClaimedSchema
  );
```

:::info[Why this way]

One statement decides and claims at the same time, with the database's clock, so two functions on two Vercel instances cannot both think the lease is free. A read followed by an update would leave that gap. The lease is 20 s, not 8, because a warmer may overrun the budget: a tick that died keeps its lease for at most the budget plus one warmer.

:::

## 3. Who schedules a tick

Two callers, both inside `after()`, so the user's response never waits. The first is the app layout, `app/(app)/layout.tsx`: every page load under the app schedules a tick with the viewer's currency and calendar day. Most loads find nothing due and the claim returns null. The second is the versions poll, `/api/cache/versions`, the request a page with a cache sends about once a minute to learn whether its numbers changed. Its `scheduleWarmup` (route L105–L122) reads the org's row and schedules a tick while the run is incomplete or finished more than 5 minutes ago, and nobody holds the lease. The read only spares the attempt; the claim still decides.

```tsx title="app/(app)/layout.tsx · L110–L121"
  // ESC-753: the org's cached pages, warmed after the response with the viewer's currency and day
  // (`after()` has no cookies). One tick per org at a time; most loads find nothing due.
  if (orgId) {
    const currency = resolveCurrency(userData.preferences);
    const today = formatDateLocal(await getClientToday());
    after(() =>
      warmupTick(orgId, { currency, today, trigger: 'page' }).catch((error) => {
        console.error('[warmup] tick failed', error);
      })
    );
    warmupPlan = await resolveWarmupPlan(orgId, currency, has);
  }
```

:::info[Why this way]

A page load alone gives one tick per visit, which is too slow for a cold org with five platforms. The poll was already there, so it became the heartbeat: an org warms in a few minutes while anyone looks at a cached page. The alternative, a timer on the server, does not exist on Vercel outside production crons.

:::

:::warning[Gotcha]

`after()` has no cookies: the currency and the day are read before it and passed in. The second trap is the README's "while someone has a tab open". The poll is mounted only by pages with a cache (`useSurfaceVersion` with an interval: Dashboard, Ads, Products, LTV, Inventory, Customer Journey, Monitoring, plus the shell while a reprocess settles). A tab parked on Settings sends no poll, so an org whose only visitor sits there gets exactly one tick per load. That is why Bruno's Ads tab matters in the walk-through.

:::

## 4. What is warmed: the list of warmers

A warmer is one unit the tick runs: an id like `dashboard:ARS` and a `run()` that brings its keys up to date. `listWarmers` builds the org's list from two independent groups. The Analytics group, behind `getAccessPass` (the same check as the analytics layout): the dashboard snapshot, then each connected Ads platform in the Ads page's order (`getPixelAdContext`), then, only with the advanced plan (`hasAdvancedAccess`), Products, LTV and Inventory. The Pixel group, behind `getPixelAccessPass`: Customer Journey when a Pixel source is connected, then Monitoring when the org has a Meta destination. A Pixel-only org still warms its journey; both passes blocked gives an empty list, which counts as a complete run. The viewer's permissions play no part: the server warms what the org can see, and the browser decides per user (two mechanisms down). Only the viewer's currency goes in: `currencies: [currency]`.

```ts title="lib/server-functions/warmup/warmers.ts · L361–L383"
async function analyticsWarmers(
  orgId: string,
  orgContext: OrgContext,
  { currencies, today, now }: WarmerScope
): Promise<Warmer[]> {
  const analyticsPass = await getAccessPass(orgId, orgContext.orgSubscription);
  if (analyticsPass.is_blocked) return [];

  const ctx = await getPixelAdContext([orgId]);
  const isAdvanced = hasAdvancedAccess(orgId, orgContext.orgSubscription);
  const [productArgs, ltvArgs] = isAdvanced
    ? await Promise.all([resolveProductDaysArgs(orgId, 'product_id'), resolveLtvArgs(orgId)])
    : [null, null];
  return [
    ...currencies.map((currency) => dashboardWarmer(orgId, currency, today, now)),
    ...ctx.connectedPlatforms.flatMap((platform) =>
      currencies.map((currency) => adsWarmer({ platform, ctx, orgId, currency, isLimited: false }))
    ),
    ...(productArgs ? [productAnalyticsWarmer(productArgs, today)] : []),
    ...(ltvArgs ? currencies.map((currency) => ltvWarmer(ltvArgs, currency, now)) : []),
    ...(isAdvanced ? [inventoryWarmer(orgId, today, now)] : []),
  ];
}
```

:::info[Why this way]

One currency per tick, the viewer's, beat warming every currency the org ever used. Each currency costs the Ads warmer 11 day-cache keys on a five-platform org (two grains per platform plus the margin) against a cap of `MAX_DAY_KEYS`, 32: three currencies are 33 keys, and the warm-up would evict its own. And since the warm-up's refresh counts as use, a currency opened once would stay warm forever. Another user in another currency warms it with their own load or poll, one run later.

:::

## 5. Check, do not recompute; never take the last slot

A warmer looks first and computes only what is missing or stale. The Ads warmer asks `checkDays` for the platform grain, the campaign grain and the margin key over the 125-day window; it reads only the stored days' fingerprints, never a payload. The call carries `{ touch: true }`: every key with stored days gets its `last_used_at` set to now, and since `trimDayKeys` keeps the 32 most recently used keys and deletes the rest, the keys the warm-up touches are never the ones that go. If a day is missing or stale, `readAdsDays` runs with `onlyUnderCap: { ceiling: WARMUP_SLOT_CEILING }` (the per-day cache is in [Ads](03-ads.md)). The ceiling is `MAX_CONCURRENT_RECALCULATIONS - 1`: with 3 global slots, the warm-up never holds the third. The dashboard warmer passes the same number as `slotCeiling`. No free slot throws `DailyReportPendingError` and the tick stops with `stoppedBy: 'cap'`; ClickHouse out of memory or a dropped socket stops it with `'clickhouse_load'`. Both are retried by the next tick at the same warmer. Any other error skips the warmer and counts it as failed.

```ts title="lib/server-functions/warmup/warmers.ts · L149–L169"
      const now = Date.now();
      const window = snapshotWindow(now);
      const check = (request: DailyReportRequest) => checkDays(request, now, { touch: true });
      const checks = await Promise.all([
        check(adsDaysRequest(args, 'platform', window)),
        check(adsDaysRequest(args, 'campaign', window)),
        check(marginDaysRequest(args, window)),
      ]);
      const daysHit = checks.reduce((sum, days) => sum + days.current.length, 0);
      const toCompute = checks.reduce(
        (sum, days) => sum + days.stale.length + days.missing.length,
        0
      );
      const wholeKeysComputed = checks.filter(
        (days) => days.current.length === 0 && days.stale.length === 0
      ).length;
      if (toCompute > 0) {
        await readAdsDays(args, { onlyUnderCap: { ceiling: WARMUP_SLOT_CEILING } });
      }
      await readAdsObjects(args);
      return { daysHit, daysComputed: toCompute, wholeKeysComputed };
```

:::info[Why this way]

A user's own request must always be able to compute, so background work leaves one slot alone. Sharing all three slots would let a warm-up on one org make another org's page wait. Checking fingerprints before reading payloads keeps a run on a warm org at zero ClickHouse queries: `wholeKeysComputed` stays 0, and anything else means a key was evicted and refilled. What is not warmed: keys with an account filter, the Limited role, the `adset` and `ad` grains, the variant and SKU grains of Products, other currencies, and orgs nobody opens.

:::

## 6. The browser's plan, built on the server

The server half makes the org's caches current. The browser half copies them into the tab of a user who is not on those pages. What a tab may copy is decided per load on the server: `resolveWarmupPlan` in the layout gathers the viewer's permissions, both access passes, the connected platforms and the Meta destination, and `buildWarmupPlan` turns them into an ordered list of entries, each naming one cached page's key: dashboard rows for a full reader of reports (the snapshot route refuses the Limited role its rows), Ads days per platform for `org:pixel:read`, product days and the LTV grid for a reports reader on the advanced plan, the Inventory pair for `org:inventory:read` on the advanced plan, none of those while Analytics is blocked; then Monitoring days for a Pixel reader whose Pixel pass is open and whose org has a Meta destination. The plan reaches the browser as the `plan` prop of `AppCacheProvider`; if building it fails, it is empty and `[warmup] browser plan failed` is logged.

```ts title="lib/cache/warmup-plan.ts · L68–L84"
  const plan: WarmupPlan = [];
  if (!analyticsBlocked) {
    if (canReadReports && !isLimited) plan.push({ kind: 'dashboard-rows', currency });
    if (canReadPixel) {
      for (const platform of connectedPlatforms) {
        plan.push({ kind: 'ads-days', platform, currency });
      }
    }
    if (canReadReports && hasAdvancedAccess) {
      plan.push({ kind: 'product-days' });
      plan.push({ kind: 'ltv', currency });
    }
    if (canReadInventory && hasAdvancedAccess) plan.push({ kind: 'inventory' });
  }
  if (canReadPixel && !pixelBlocked && hasMetaDestination) plan.push({ kind: 'monitoring-days' });
  return plan;
}
```

:::info[Why this way]

The server already knows the permissions and passes, with React-cached reads shared with the shell. Letting the browser ask "what may I preload?" would cost a request before the first preload and duplicate the gates. A pure builder with booleans in is also the one place a new cached page adds its entry, behind its own permission and plan gate. Customer Journey is warmed on the server but not preloaded: about 70 visits a day did not justify it.

:::

## 7. useWarmup: idle, read-only, one entry at a time

`useWarmup` is the hook that walks the plan. `AppCacheProvider` mounts it inside the `QueryClient`, above every page, so it warms the pages the user is not on. It starts on mount and after each navigation, cancelling the previous run. A pass starts only when the browser is idle (`whenIdle`: `requestIdleCallback` with a 3 s timeout) and `canPreload` holds: tab visible, no `navigator.connection.saveData`, no `slow-2g`, `2g` or `3g` connection; otherwise the run ends until the next navigation. Entries go one at a time, skipping a key already in memory or being fetched. Every fetch is read-only: the snapshot route answers 204 when it has no rows, and the days routes take `?ifCached=1` and answer 204 when any day is missing, never computing. A 204 becomes `null` and stores nothing (the dashboard reads a null as "go live"). A body goes in with `setQueryData` under the exact key the page reads, after raising that key's `gcTime` to `SURFACE_GC_TIME_MS`, 2 hours, and the persister writes the same key to the device. Empty entries are asked again after `WARMUP_FIRST_RETRY_MS`, 20 s, then every `WARMUP_RETRY_MS`, 60 s, up to `WARMUP_PASSES`, six passes: about five and a half minutes.

```ts title="lib/cache/use-warmup.ts · L145–L171 (trimmed)"
    const runPass = async (pending: WarmupEntry[], pass: number) => {
      if (!canPreload()) return;
      const empty: WarmupEntry[] = [];
      for (const entry of pending) {
        let isEmpty = false;
        for (const part of entryParts(scope, entry)) {
          if (cancelled) return;
          if (isPresent(queryClient, part.key)) continue;
          try {
            const answer = await part.fetch();
            if (cancelled) return;
            if (answer === null || answer === undefined) isEmpty = true;
            else store(part.key, answer);
…
        }
        if (isEmpty) empty.push(entry);
      }
      if (cancelled || empty.length === 0 || pass >= WARMUP_PASSES) return;
      retryTimer = window.setTimeout(
        () => {
          retryTimer = null;
          cancelIdle = whenIdle(() => void runPass(empty, pass + 1));
        },
        pass === 1 ? WARMUP_FIRST_RETRY_MS : WARMUP_RETRY_MS
      );
```

:::info[Why this way]

A preload only ever saves a request; it must never cost one that computes. So the browser reads, the server computes, and the retries follow the server's rhythm: 20 s for the load's own tick, then one per poll. Writing into the page's exact key beat a separate preload store because the page needs no new code to benefit. Raising `gcTime` matters because a key no page has mounted would be collected after the client's default 30 minutes, before the user clicks. Not preloaded: the Limited role's dashboard, account-filtered keys, other currencies, adsets and ads, variant and SKU grains, Inventory issues and events, Customer Journey, and Monitoring's Klaviyo view.

:::

## Follow a request

1. **Browser (Ana, 9:00:00)** · GET `/settings`. `AppLayout` reads her currency with `resolveCurrency` (ARS) and her day with `getClientToday`, registers `after(() => warmupTick(…, trigger: 'page'))`, and `resolveWarmupPlan` builds `[dashboard-rows ARS, ads-days meta ARS, ads-days google ARS]`. The page streams.
2. **Server, after()** · `claimWarmupTick` inserts the org's first `org_warmup` row and wins at `next_index` 0. `listWarmers`: the Analytics pass is open, the Pixel pass is blocked, so the list is `dashboard:ARS, ads:meta:ARS, ads:google:ARS`.
3. **Server, tick 1** · The dashboard warmer calls `refreshDashboardSnapshot` twice (recent part, then the older part), say 7 s. The next loop check finds the budget spent: `stoppedBy: 'budget'`, `next_index` 1, `finished_at` NULL, one `event: 'warmup'` line.
4. **Browser (Ana, 9:00:03)** · `useWarmup` pass 1 after `whenIdle`: `fetchDashboardSnapshot` gets 204 (still building), `fetchAdsDays(…, { ifCached: true })` gets 204 twice. All three are empty; a timer is set for 20 s.
5. **Browser (Bruno, 9:00:30)** · GET `/pixel/ads`. His load's `after()` claims the free lease at `next_index` 1. Tick 2 runs `ads:meta:ARS`: `checkDays` finds every day missing, `readAdsDays` computes under ceiling 2, `readAdsObjects` follows. The budget ends the tick at `next_index` 2.
6. **Browser (Ana, 9:00:23)** · Pass 2: the snapshot answers 200. `store` sets `gcTime` 2 h on `dashboardSnapshotKey(scope, 'ARS')`, calls `setQueryData`, and the persister writes the device copy. Ads still 204; next pass in 60 s.
7. **Server (Bruno's poll, 9:01:30)** · GET `/api/cache/versions?currency=ARS`. `scheduleWarmup` sees `finished_at` NULL and no lease, schedules tick 3 with `trigger: 'poll'`. It runs `ads:google:ARS`, the last warmer: `finished: true`, `next_index` 0, `finished_at` set, `summary` stored.
8. **Browser (Ana, 9:01:23 and 9:02:23)** · Pass 3 stores Meta's days under `adsDaysKey(scope, { currency: 'ARS', platform: 'meta', accounts: '' })`; pass 4 stores Google's. Nothing is left empty, so no further timer is set.
9. **Browser (Ana, 9:04)** · She taps Dashboard. The page's `useQuery` on `dashboardSnapshotKey(scope, 'ARS')` finds data and renders without a request; its own versions poll then confirms the version ([Dashboard](02-dashboard.md)).

## Where to look

| Role | File |
| --- | --- |
| The tick: budget loop, stop reasons, log line | `lib/server-functions/warmup/warmup-tick.ts` |
| The lease and the row: claim, save, read status | `lib/server-functions/warmup/warmup-store.ts` |
| Budget, lease and interval constants; summary shape | `lib/server-functions/warmup/model.ts` |
| The warmers, their gates, order and ceiling | `lib/server-functions/warmup/warmers.ts` |
| The `org_warmup` table | `docs/migrations/032_org_warmup.sql` |
| Page-load trigger; cookies read before `after()`; plan built per load | `app/(app)/layout.tsx` |
| Poll trigger (`scheduleWarmup`) | `app/api/cache/versions/route.ts` |
| The poll hook that pages with a cache mount | `lib/cache/use-cache-versions.ts` |
| The browser plan's entries and pure builder | `lib/cache/warmup-plan.ts` |
| The browser walk: conditions, read-only fetches, store, retries | `lib/cache/use-warmup.ts` |
| `requestIdleCallback` with a 3 s timeout | `lib/cache/when-idle.ts` |
| Where `useWarmup` mounts, above every page | `components/providers/app-cache-provider.tsx` |
| `MAX_CONCURRENT_RECALCULATIONS` (3), `MAX_DAY_KEYS` (32), the 125-day window | `lib/dashboard/snapshot/model.ts` |
| `SURFACE_GC_TIME_MS` (2 h) | `lib/cache/surface.ts` |
| `checkDays` and the key trim by `last_used_at` | `lib/server-functions/reporting/cached-daily-report.ts`, `lib/server-functions/reporting/day-cache-store.ts` |
| Current behaviour in Spanish (sections "Warm-up del servidor", "Warm-up del navegador") | `docs/features/client-cache/README.md` |

## Terms

- **`tick`**: One call of `warmupTick`: walks warmers under an 8 s budget, then saves where it got to.
- **`run`**: All the ticks from `next_index` 0 to the last warmer; complete when `finished_at` is set (README: "corrida").
- **`warmer`**: One unit of the list: an id (`dashboard:ARS`, `ads:meta:ARS`, `inventory`) and a `run()` that brings its keys up to date.
- **`lease`**: `org_warmup.claimed_at` within the last 20 s: the one caller allowed to tick this org.
- **`next_index`**: The warmer the next tick starts from; 0 once the run completed.
- **`stoppedBy`**: Why a tick stopped before the last warmer: `budget`, `cap`, `clickhouse_load` or `error`; null when the run completed.
- **`WARMUP_SLOT_CEILING`**: `MAX_CONCURRENT_RECALCULATIONS - 1`: the warm-up never takes the last global slot.
- **`touch`**: The `checkDays` option that stamps `last_used_at` on every key with stored days, so the key trim keeps it.
- **`wholeKeysComputed`**: Keys with no stored day that a warmer computed whole; 0 on a warm org whose data did not change.
- **`org_warmup.summary`**: The run's totals per warmer (days hit and computed, ClickHouse queries, why it stopped): what to read on staging after opening a page.
- **`event: 'warmup'`**: The one log line per tick, with the tick's own counts, `trigger` (`page` or `poll`), `finished` and `stoppedBy`.
- **`warm-up plan`**: The ordered `WarmupEntry` list the layout builds per load for this viewer's tab.
- **`pass`**: One walk of the plan's still-empty entries by `useWarmup`; at most six per navigation.
- **`ifCached`**: The query flag that makes a days route answer 200 only from stored days, 204 otherwise, never computing.
