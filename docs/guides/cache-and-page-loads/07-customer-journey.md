---
title: "Customer Journey"
sidebar_label: "7. Customer Journey"
sidebar_position: 7
description: "After this chapter you can predict which clicks on the journey page cost a ClickHouse query and which are answered from stored days or a stored range entry. You can also say why this page is warmed on the server but never preloaded by the browser."
---

# Customer Journey

*After this chapter you can predict which clicks on the journey page cost a ClickHouse query and which are answered from stored days or a stored range entry. You can also say why this page is warmed on the server but never preloaded by the browser.*

<small>~9 minBuilt on: ESC-756, ESC-759, docs/features/client-cache/README.md</small>

:::tip[In plain words]

Ana opens Customer Journey on Sunday 2026-11-16 at 9:25. The toolbar appears at once with the real values: Last 30 days, the platform level, her currency. Below it the funnel and the four blocks show grey placeholders. About a second later they fill in, all at the same moment; "Where they are lost" fills in on its own. Two seconds later, if her Meta campaigns run ads without the shop's URL parameters, a yellow banner slides in above the report. Nothing waited for it.

At 9:26 she picks Last 14 days. The blocks stay on screen, a small spinner turns next to the level tabs, and each block is replaced in place when its new numbers land. Nobody counted anything from scratch: the server already held every day of the last 125 days for her shop, and the session counts for Last 14 days were stored before she clicked. Then she switches to the campaign level. The funnel, the paths, the open-and-close table and the overlap are rebuilt from the same stored days, grouped by campaign, with the names looked up on the way. "Where they are lost" does not blink: the level means nothing to it. Back an hour later with the same view, the page draws from her own browser with no request.

:::

## 1. The gates, and nothing else, before the frame ships

Before any route answers, two things are checked in the page's own order: the org's Pixel subscription is open (the Pixel access pass, not the Analytics one) and the org has a connected Pixel source with a web store. The page and its three API routes share one function for this, `authorizeJourney`, so the API is no way around the paywall and a blocked org never starts a computation. The server component resolves the gates and the controls' values, then sends the frame with no report numbers in it.

```ts title="app/api/pixel/customer-journey/route-context.ts · L39–L61"
export async function authorizeJourney(
  req: NextRequest
): Promise<JourneyRequestContext | NextResponse> {
  const { orgId, has } = getAuth(req);
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (
    !has({ permission: PERMISSIONS.PIXEL_READ }) &&
    !has({ permission: PERMISSIONS.REPORTS_READ })
  ) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  try {
    const { orgContext, orgSubscription, pixelConfigEnabled } = await getOrgContext(orgId);
    const [pass, pixelConfig] = await Promise.all([
      getPixelAccessPass(orgId, orgSubscription),
      getPixelConfig(orgId),
    ]);
    if (pass.is_blocked) return NextResponse.json({ error: ORG_BLOCKED_ERROR }, { status: 403 });
    const storeId =
      orgContext.store_type === 'shopify' ? orgContext.shopify : orgContext.tiendanube;
    if (!storeId || resolvePixelSource(pixelConfig) === null) {
      return NextResponse.json({ error: 'No source' }, { status: 404 });
    }
```

:::info[Why this way]

A blocked org answers 403 with `ORG_BLOCKED_ERROR`, which the browser turns into a reload onto the paywall or the teaser. Computing and hiding the result in the UI would spend ClickHouse on orgs that no longer pay.

:::

## 2. Journey days: one key per org and currency

The per-day cache of [Ads](03-ads.md) holds a row per entity per day. Here a day's rows are the orders bought that day, each with its whole journey at the finest grain (channel, campaign entity, ad), its stage times and its revenue in one currency. Every row of an order carries its purchase date, so an order falls into exactly one day and a range is the concatenation of its days. The key names what changes a stored row and nothing else: store, currency, Klaviyo account, sorted ad accounts, FX settings. The level and the customer filter are not in it; they are applied when the blocks are built.

```ts title="app/(app)/pixel/customer-journey/journey-data.ts · L106–L128"
export function journeyDaysRequest(
  args: JourneyDaysArgs,
  range: JourneyDaySpan = journeyWindow()
): DailyReportRequest {
  return {
    surface: CUSTOMER_JOURNEY_SURFACE.id,
    orgId: args.orgId,
    params: {
      code: JOURNEY_DAYS_CODE_VERSION,
      store: args.storeId,
      currency: args.currency,
      klaviyo: args.klaviyoAccountId,
      accounts: args.accountIds,
      preferredArs: args.preferredArs,
      dollarFee: args.dollarFee,
    },
    sources: DAY_SOURCES,
    // The catalogs the SQL reads (`ad_objects`, `email_objects`) are left out on purpose (design §1).
    hasUnmarkedSources: false,
    start: range.start,
    end: range.end,
  };
}
```

:::info[Why this way]

Storing the finest grain under one key per currency means a level, range or currency change inside the window reads Postgres and never ClickHouse. One key per level would triple the keys and recompute the same orders three times. The accepted price: a campaign synced after a day was stored shows as `_unlinked` in that day until it is recomputed, because the catalogs have no mark.

:::

## 3. The blocks are built on the server, from the stored days

The browser never receives the orders. One route, `GET /api/pixel/customer-journey/blocks`, reads the days of the range once and builds the funnel, "Top caminos", open-and-close and the overlap with the same pure builders as before (`buildJourneyBlocks`), for the level and filter asked. Each block is built in its own `try`: one that fails comes back as `{ ok: false }` and the others are drawn. Campaign and ad names are looked up per request, once for the level's nodes. The open-and-close spend is no longer a live ads report: `journeySpendFromAdsDays` sums the campaign days the Ads page keeps. A range starting before the window skips the days and runs the live query.

```ts title="app/api/pixel/customer-journey/blocks/route.ts · L120–L162"
        const respond = async (
          orders: JourneyOrder[],
          { isStale, outcome }: { isStale: boolean; outcome: CacheOutcome }
        ) => {
          const inputs = await journeyBlockInputs(args, orders, { level, start, end, isLimited });
          const data: JourneyBlocksData = {
            ...buildJourneyBlocks(orders, { level, customers }, inputs!),
            query: { start, end, level, customers, currency },
            ...(await journeyFreshness(orgId)),
            isStale,
            source: outcome === 'hit' ? 'cache' : 'computed',
          };
          return answer(NextResponse.json(data), outcome);
        };
        …
        const read = await readJourneyOrders(args, range);
        later(presets);
        return await respond(read.orders, read);
```

:::info[Why this way]

A month of the largest store is about 16,000 orders with their journeys. Shipping them to the phone and summing there, as the [Dashboard](02-dashboard.md) does with its daily rows, would cost more bytes than the blocks. With `ifCached=1` the route never computes: 204 when a day is missing, the work queued after the response under `PRELOAD_SLOT_CEILING`.

:::

## 4. Sessions: a range entry per range, with the presets stored ahead

"Where they are lost" counts Pixel sessions per entry channel. A session crosses days and is counted once, so it cannot be a day row. It is an entry of the range cache of [LTV](05-ltv.md), one per org, store and range (the range is in the key), valid while the `pixel_sessions` marks hold and for at most an hour. Its route is `GET /api/pixel/customer-journey/lost-sessions`. So that a preset never waits, the page's nine presets, resolved for the viewer's calendar day, are stored before anyone clicks them: `warmJourneyPresets` runs after the blocks route answers and inside the server warm-up, one preset at a time, only while a global slot is free with one more left, stopping at the first one someone else is computing and at `PRESET_WARMUP_BUDGET_MS` (8 s from the request's start). A hand-picked range with no entry is computed once in the request behind its placeholder; the other blocks do not wait for it.

```ts title="app/(app)/pixel/customer-journey/journey-data.ts · L269–L301"
export async function warmJourneyPresets(
  args: SessionsScope,
  …
  deadlineMs: number
): Promise<number> {
  const window = journeyWindow(now);
  const ranges = journeyPresetRanges(today).filter(
    (range) => range.start >= window.start && range.end <= window.end
  );
  let stored = 0;
  for (const [index, range] of ranges.entries()) {
    if (Date.now() >= deadlineMs) {
      console.info('[preset-warmup] stopped at budget', {
      …
      break;
    }
    if (await peekLostSessions(args, range.start, range.end, now)) continue;
    try {
      await readLostSessions(args, range.start, range.end, { onlyUnderCap: { ceiling } });
      stored += 1;
    } catch (error) {
      if (error instanceof RangeReportPendingError) break;
      throw error;
    }
  …
```

:::info[Why this way]

Storing the presets ahead makes the common clicks free; only hand-picked ranges pay. A day cache of sessions would double-count a session that spans midnight. The deadline exists because the loop ran inside the request function's own time limit (ESC-759): past 8 s it logs one line and leaves the rest for the next check instead of being killed mid-write.

:::

## 5. Two queries in the browser, kept on screen while the next one loads

The client component `JourneyBlocksClient` asks exactly two things: `journeyBlocksKey` (range, level, filter, currency) and `journeyLostSessionsKey` (range only). Both live two hours in memory (`SURFACE_GC_TIME_MS`) and on the device, so a return or a reload with the same view draws before any request. The range and the level change in the URL in place (`pushState`); the currency comes from the shared preference with no server round-trip. With `keepPreviousData` the old blocks stay until the new answer lands, with the spinner next to the level tabs on. A level change asks only the first query. The version poll of [chapter 1](01-the-big-picture.md) invalidates both when the org's marks move.

```tsx title="components/pixel/customer-journey/journey-blocks-client.tsx · L108–L126"
  const blocks = useQuery<JourneyBlocksData>({
    queryKey: scope
      ? journeyBlocksKey(scope, blocksQuery)
      : noScopeKey('blocks', currency, level, 'all', start, end),
    // Never null without `ifCached`: only a preload can be answered with nothing.
    queryFn: async ({ signal }) =>
      (await fetchJourneyBlocks(blocksQuery, {}, signal)) as JourneyBlocksData,
    enabled: canAsk,
    staleTime: Infinity,
    gcTime: SURFACE_GC_TIME_MS,
    placeholderData: keepPreviousData,
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

Two queries because they move for different reasons: the sessions block ignores the level, the filter and the currency, so a level change must not refetch it. The earlier `Suspense` boundary keyed by the view blanked every block on each change; keeping the previous data and swapping in place beat it.

:::

## 6. The UTM alert: one hourly entry shared with Products

The banner about Meta campaigns running ads without the shop's URL parameters used to be awaited on the server: URL tags, the ad catalog and a live ads report, about 1.4 s before any HTML. Since ESC-759 it is its own route, `GET /api/pixel/customer-journey/utm-alert`, which the page shell asks only once the blocks have settled (data, empty or error), through the `settled` flag of `JourneyPendingProvider`. The answer lives an hour in memory, never on the device, with no retries. The org's status is one range entry under a one-day range, `readUtmAlertStatus`, the same entry [Products](04-products.md) reads and its warmer keeps warm. The reader rule (Pixel on, `org:pixel:manage`) is applied per request, never stored; any failure answers `{ status: null }`, which hides the banner.

```ts title="lib/server-functions/pixel/utm-alert-status.ts · L24–L37"
export async function readUtmAlertStatus(
  orgId: string
): Promise<RangeReportAnswer<UtmCampaignStatusResult | null>> {
  const today = todayUtc();
  return cachedRangeReport<UtmCampaignStatusResult | null>({
    surface: PRODUCT_ANALYTICS_SURFACE.id,
    orgId,
    params: { code: PRODUCT_DAYS_CODE_VERSION, kind: 'utm-alert' },
    sources: [],
    start: today,
    end: today,
    compute: () => getUtmCampaignStatus(orgId),
  });
}
```

:::info[Why this way]

One entry for both pages: the first to ask in an hour pays, the other reads. The key stayed under the Products surface and code version on purpose; renaming it would have recomputed every org's status for nothing. Asking after the blocks settle keeps the one request the user waits for alone on the wire.

:::

:::warning[Gotcha]

The entry is stored under the `product-analytics` surface, but the journey route logs and sends `X-Cache` under `customer-journey`. The `event: 'cache'` lines show the alert's hits on the journey side; its row in the range cache sits on the Products side. Both are correct; do not "fix" one.

:::

## 7. Warmed by the server, skipped by the browser

The server warm-up tick of [chapter 9](09-warm-up.md) lists a `customer-journey` warmer behind the Pixel access pass, apart from the Analytics group: it checks the fingerprints of the window's journey days in the viewer's currency (`checkDays` with `touch`, so the key counts as used), reads the days if any is missing or stale, then stores the missing session presets. The browser plan does the opposite: `buildWarmupPlan` has no entry for this page. About 70 visits a day across every org do not justify copying two answers into every open tab; a cold tab pays one request per query.

```ts title="lib/server-functions/warmup/warmers.ts · L291–L308"
function customerJourneyWarmer(args: JourneyDaysArgs, today: string): Warmer {
  return {
    id: 'customer-journey',
    run: async () => {
      const now = Date.now();
      const window = snapshotWindow(now);
      const days = await checkDays(journeyDaysRequest(args, window), now, { touch: true });
      const toCompute = days.stale.length + days.missing.length;
      if (toCompute > 0) {
        await readJourneyDays(args, window, { onlyUnderCap: { ceiling: WARMUP_SLOT_CEILING } });
      }
      const rangesStored = await warmJourneyPresets(
        args,
        today,
        now,
        WARMUP_SLOT_CEILING,
        now + PRESET_WARMUP_BUDGET_MS
      );
```

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

Warming on the server makes the first visit cheap for everyone at the cost of one tick per org; preloading in the browser would add two requests to every tab for a page most users never open that day. Monitoring, the other Pixel page, is preloaded because its visitors come daily. The split is per page, by visits, not by product.

:::

:::warning[Gotcha]

The header comment of `app/(app)/pixel/customer-journey/loading.tsx` still says the server resolves "the gates, the range and the UTM status" and that the banner "is part of what the page is waiting for". That was true before ESC-759; today the page awaits the gates only and the banner is the lazy query above. The README's skeleton section is right; the comment is stale. The file itself stays: without it a navigation would show the previous page until the pass and the source resolve.

:::

## What is different on this page

- **Pixel product gate, not Analytics.** Every other cached page sits behind `getAccessPass`; here the page, the routes and the warmer ask `getPixelAccessPass`, so a Pixel-only org with Analytics blocked keeps its journey, its cache and its warm-up.
- **A `loading.tsx` is kept.** The server waits for the gates, so the loading file renders the real toolbar. Dashboard and Ads dropped theirs because their servers wait for nothing.
- **Not in the browser warm-up plan.** Server warmer yes, browser preload no, on visit volume alone.
- **Sessions as range entries, with the range in the key.** The guide's other range entries are keyed by org, currency and day; here two ranges would otherwise collide.
- **Blocks built on the server.** The browser never sums journey rows; a range is thousands of orders.

## Follow a request

1. **Server** · 9:25. `page.tsx` resolves `getPixelAccessPass` and `resolvePixelSource`, then the range (`last30`: 2026-10-18 to 2026-11-16), level and currency, and ships the shell with no numbers; `loading.tsx` showed the same toolbar meanwhile.
2. **Browser** · `JourneyBlocksClient` finds nothing under `journeyBlocksKey` or `journeyLostSessionsKey` and fires both routes.
3. **API route** · `/blocks` passes `authorizeJourney`; the range is inside the window, so `readJourneyDays` reads 30 stored days from Postgres. `journeyBlockInputs` sums the spend from the Ads campaign days; `buildJourneyBlocks` returns the four blocks, `X-Cache: hit`. After the response `warmJourneyPresets` finds every preset stored.
4. **API route** · `/lost-sessions` finds the range's entry in the range cache: `hit`.
5. **Browser** · Both land; the blocks replace the placeholders. `hasSettled` flips, the shell asks `/utm-alert`, which applies the reader rule and reads `readUtmAlertStatus`; the banner appears.
6. **Browser** · 9:26, Last 14 days. The toolbar writes `?start=2026-11-03&end=2026-11-16` with `pushState`; `journeyViewFromUrl` reads it; two new keys, both empty; both routes fire while `keepPreviousData` holds the old blocks.
7. **API route** · `/blocks` reads 14 of the same stored days and rebuilds; `/lost-sessions` finds the `last14` entry the warmer stored ahead. Neither touches ClickHouse.
8. **Browser** · Campaign level. Only `journeyBlocksKey` changes. `/blocks` reads the same 14 days, `resolveJourneyEntities` names the campaign nodes in one lookup, and the blocks are swapped in place.

## Where to look

| Role | File |
| --- | --- |
| Server component: gates, controls, frame | `app/(app)/pixel/customer-journey/page.tsx` |
| Kept loading state: the real toolbar | `app/(app)/pixel/customer-journey/loading.tsx` |
| Page shell and the lazy UTM query | `app/(app)/pixel/customer-journey/client.tsx` |
| Day key, sessions entries, preset warm-up, spend, builders | `app/(app)/pixel/customer-journey/journey-data.ts` |
| Shared gates and cache logger | `app/api/pixel/customer-journey/route-context.ts` |
| The three routes | `app/api/pixel/customer-journey/{blocks,lost-sessions,utm-alert}/route.ts` |
| The hourly UTM entry shared with Products | `lib/server-functions/pixel/utm-alert-status.ts` |
| Browser keys, endpoints, fetchers, URL view parsing | `lib/customer-journey/surface.ts` |
| The surface and its marked tables | `lib/cache/surface.ts` |
| The two browser queries and the in-place swap | `components/pixel/customer-journey/journey-blocks-client.tsx` |
| Server warmer for this page | `lib/server-functions/warmup/warmers.ts` |
| Browser warm-up plan (no entry for this page) | `lib/cache/warmup-plan.ts` |

## Terms

- **`journey day`**: The orders bought on one day with their whole journey at the finest grain, one key per org and currency (README: "journeys por día de compra").
- **`blocks`**: Funnel, "Top caminos", open-and-close with spend, overlap: built on the server for one range, level, filter and currency; each may fail alone.
- **`lost sessions`**: "Where they are lost": Pixel sessions per entry channel, one range entry per range (README: "Dónde se pierden").
- **`preset warm-up`**: Storing the nine presets' sessions entries for the viewer's day before the click, under the slot ceiling and an 8 s deadline.
- **`settled`**: The blocks have a first answer, empty or error; the shell may now ask the UTM alert.
- **`Pixel access pass`**: The Pixel product's subscription gate (`getPixelAccessPass`), not the Analytics one.
