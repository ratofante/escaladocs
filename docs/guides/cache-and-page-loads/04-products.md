---
title: "Products"
sidebar_label: "4. Products"
sidebar_position: 4
description: "After this chapter you can predict which clicks on the Products page cost a request and which cost nothing. You can also say why two columns of the table sometimes fill in a moment after the rest."
---

# Products

*After this chapter you can predict which clicks on the Products page cost a request and which cost nothing. You can also say why two columns of the table sometimes fill in a moment after the rest.*

<small>~8 min · Built on: ESC-754, ESC-756, ESC-759, docs/features/client-cache/README.md ("Ejemplo resuelto: Productos")</small>

:::tip[In plain words]

Sunday 16 November 2026, 9:10. Ana opens Products. The frame of the page appears at once: header, chart card, table head and a page of grey rows. About a second later the rows fill with numbers for her usual range, Last 7 days, in her store's currency. The server had already worked out every product's numbers for every day since mid July while someone had the app open the day before, so this morning it only hands them over. Two columns, Customers and Repeat customers, show small grey bars for a moment and then fill in too. Last of all a banner may appear above the table, about ads running without the store's URL parameters.

Ana picks Last 30 days. The address bar changes, nothing reloads, and the table and the daily chart redraw immediately: the browser already holds every day it needs and adds up a different set of them. The two customer columns go grey again and fill a moment later.

She switches the grain to SKU. The frame comes back and the grey rows stay for a few seconds: nobody had opened the SKU view of this store before, so the server computes it now and keeps it for the next person.

She switches to USD. The change is instant, with no request: every number was stored in both currencies, so the switch picks the other one. Her choice is remembered for next time.

:::

Products (`/product-analytics`) is the second page on the per-day cache, after [Ads](03-ads.md), which explains entries, keys, spans, the lease, the cap and the peek. This chapter covers only what Products adds or does differently.

## 1. One key per grain

The table can be read by product, by variant or by SKU. Each is its own set of stored days, named by its key, which holds only what changes a grain's numbers: a code version (bumped when a formula or the stored shape changes, so old days stop being read), the grain, the org's stores sorted, and the MercadoLibre "remove IVA" setting. No range, locale, currency or role, so an org uses at most three of the 32 keys it may hold (`MAX_DAY_KEYS`). Variant and SKU days are computed the first time anyone switches to that grain; the warm-up fills only the product one.

```ts title="app/(app)/(analytics)/(advanced)/product-analytics/days-data.ts · L59–L65"
/** What changes a grain's numbers, and nothing else: never the range, the locale or the currency. */
const scopeParams = (args: ProductDaysArgs) => ({
  code: PRODUCT_DAYS_CODE_VERSION,
  grain: args.groupBy,
  stores: args.storeIds,
  meliIva: meliIvaKey(args.meliIva),
});
```

:::info[Why this way]

Ads keys its days per platform and currency, so a five-platform org burns 11 keys per currency. Products has no Limited variant and, with the next mechanism, no per-currency query, so one key per grain is enough. A key per grain and currency would have doubled the stored days and the warm-up for no new number.

:::

## 2. Both currencies in the same stored day

A stored day is one row per product, platform and date. Every money measure appears twice: as stored, in the store's currency, and multiplied by the exchange rate that the ClickHouse row itself carries, which gives USD. The rate is a grouping key in the first level of the query because rows of one day can carry different rates (some carry 0) and each must convert with its own. The live report does the same, so the two agree.

```ts title="lib/server-functions/reporting/product-analytics-days.ts · L178–L210"
/** `sum(expr) AS key_local, sum(expr * rate) AS key_usd`, the rate written as each part needs it. */
const bothCurrencies = (key: string, expr: (rate: string) => string) =>
  `${expr('')} AS ${key}_local,\n        ${expr(' * pa.currency_rate')} AS ${key}_usd`;
…
        -- A grouping key so the order-value states below can be converted after the merge: rows of
        -- one day can carry different rates (some carry 0), each converted with its own.
        pa.currency_rate AS currency_rate,
```

:::info[Why this way]

Converting on read with one daily rate would have changed the numbers against the live report, which converts per row. Two columns cost some bytes per day and make the currency switch free. The losing alternative was a key per currency, computed twice.

:::

:::warning[Gotcha]

Rows with `currency_rate = 0` exist (224 of 304 store days on the largest org had some). In USD those rows are worth 0, today and in the live report alike. The live report also drops a product's day unless it sold, had a return or had ad spend; a rate-0 row has ad spend locally and none in USD, so the rule is applied per currency when the browser sums (`isKept` in `sum-days.ts`), not when the day is stored. A day in the local table can be missing from the USD one; that is correct.

:::

## 3. Three shapes of answer

The days route answers for a grain's whole 125-day window at once, both currencies. Up to 20,000 rows (`PRODUCT_DAYS_BROWSER_MAX_ROWS`) it sends them all, compacted: the catalog identity once per product and platform, each day as an array. Above that it answers only the count (`mode: 'range-days'`) and the browser asks `/api/product-analytics/range-days` for the range on screen, one answer per range. A range that starts before the window is the third case: `/api/product-analytics/report` runs the live report in the asked currency behind a range entry (one stored answer of the range cache, keyed by its parameters).

```ts title="app/(app)/(analytics)/(advanced)/product-analytics/days-data.ts · L139–L148"
/** The window's days for the browser when they fit, else only their count (design §3). */
export function daysAnswer(
  rows: readonly ProductDayRow[],
  window: SnapshotWindow
): ProductDaysAnswer {
  if (rows.length > PRODUCT_DAYS_BROWSER_MAX_ROWS) {
    return { mode: 'range-days', window, rowsInWindow: rows.length };
  }
  return { mode: 'days', window, ...compactDays(rows) };
}
```

:::info[Why this way]

Sending the whole window makes every range, tab and currency change inside it free, but thousands of SKUs over 125 days do not fit a phone's memory, so the size decides. Always per range would cost a request on every range change; always whole would freeze the biggest orgs.

:::

## 4. One sum in the browser

Whichever shape arrived, the browser turns days into the table with one function. It keeps the days inside the range, picks the asked currency's measures, adds them into one entry per product and platform, and derives the ratios from the sums, never from averages. The server never sends totals: the daily chart needs the days anyway. The function is client-safe; the live shadow test runs it on the server too.

```ts title="lib/product-analytics/days/sum-days.ts · L172–L190"
export function sumProductDays(
  days: readonly ProductDay[],
  identities: Readonly<Record<string, ProductDayIdentity>>,
  { start, end, currency }: { start: string; end: string; currency: ProductAnalyticsCurrency }
): ProductEntriesBySource {
  const bySource: ProductEntriesBySource = {};
  for (const day of days) {
    if (day.date < start || day.date > end) continue;
    const measures = day[currency];
    if (!isKept(measures)) continue;
    const bucket = (bySource[day.source] ??= {});
    const entry = (bucket[day.id] ??= newEntry(
      day.id,
      day.source,
      identities[productKey(day.source, day.id)] ?? EMPTY_IDENTITY
    ));
    entry.rows[day.date] = { ...measures, ...computeDerivatives(measures) };
    for (const key of SUMMED_MEASURES) entry.totals[key] += measures[key];
  }
```

:::info[Why this way]

Two summing paths, one for whole-window days and one for range days, would drift apart on the first formula change. Totals from the server lost because the chart would still need the days, doubling the payload.

:::

## 5. Customers as a range entry

One number cannot come from adding days: a shopper who buys on two days is one customer of the range. A stored day keeps its own exact count for the daily chart, but a range's Customers and Repeat customers are their own query, served by `/api/product-analytics/range-totals` as a range entry: the range's stored customer sets merged (`uniqExactMerge`) and the live report's repeat query over orders, together because the repeat query alone took 321 ms on the largest org. The range is part of the entry's parameters: an entry's key is its parameters alone, so before ESC-756 two ranges shared one entry and the second viewer got the first range's customers as stale. The live report entry had the same bug.

```ts title="app/(app)/(analytics)/(advanced)/product-analytics/days-data.ts · L161–L173"
function rangeTotalsRequest(args: ProductDaysArgs, start: string, end: string): RangeReportRequest {
  return {
    surface: PRODUCT_ANALYTICS_SURFACE.id,
    orgId: args.orgId,
    // Customers and repeat together: repeat took 321 ms on the largest org (design, Measurement).
    // The range is part of the key (ESC-756): the entry key is the params alone, so without it two
    // ranges shared one entry and the second was answered with the first's customers as stale.
    params: { ...scopeParams(args), kind: 'range-totals', start, end },
    sources: RANGE_TOTALS_SOURCES,
    start,
    end,
  };
}
```

Meanwhile the table has every other column; the three built on it show a loading cell per row (`pendingColumns` in `products-analytics-table.tsx`). At product grain the wait is usually zero: after every answer of the days route, the server stores the entries of the viewer's 12 preset ranges one at a time, never taking the last global slot (`PRELOAD_SLOT_CEILING`), and starts no new one 8 s after the request began (`PRESET_WARMUP_BUDGET_MS`); the next check stores the rest. The server tick does the same ([Warm-up](09-warm-up.md)).

:::info[Why this way]

Making the days route wait for the customers would delay every column for the two that need a second query. Filling them later keeps the first paint on the days alone, and the preset warm hides the gap on the clicks people actually make.

:::

## 6. The UTM alert, shared with Customer Journey

The banner about ads running without the store's URL parameters needs the org's campaign status, a read of the ad platforms that no mark watches. It is a range entry under a one-day range with no sources, so it lives an hour (`FULL_RECALCULATION_INTERVAL_MS`) and then recomputes. One entry per org serves Products and [Customer Journey](07-customer-journey.md), under the Products surface and code version where it was first stored. The browser asks `/api/product-analytics/utm-alert` only after the table has numbers; the reader's gate (Pixel on, Pixel management permission) is applied in the request, never stored.

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

Before ESC-754 the status was read on the server for every page view, ahead of the numbers. An advisory banner should not delay the table, and the status changes slowly, so one hourly entry per org is enough. Renaming the key to a shared surface would only have recomputed every org's status.

:::

## 7. The same gates on every route

The page sits under the `(advanced)` layout, which enforces the reports permission, the Analytics access pass and the advanced plan. Each of its five routes enforces the same three, in that order, through the helper the advanced pages share, so the API is no way around the paywall and a base-plan org never starts a computation. The UTM route adds its two checks on top.

```ts title="app/api/_lib/advanced-route-context.ts · L37–L51"
export async function authorizeAdvancedPage(
  req: NextRequest,
  permission: PermissionKey = PERMISSIONS.REPORTS_READ
): Promise<AdvancedRequestContext | NextResponse> {
  const authorized = authorizeApiRequest(req, permission);
  if (authorized instanceof NextResponse) return authorized;
  const { orgId } = authorized;
  const blocked = await assertOrgAccess(orgId);
  if (blocked) return blocked;
  const context = await getOrgContext(orgId).catch(() => null);
  if (!context || !hasAdvancedAccess(orgId, context.orgSubscription)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return { orgId, has: getAuth(req).has, pixelEnabled: context.pixelConfigEnabled };
}
```

:::info[Why this way]

Once the numbers left the HTML, the routes became the real door. Checking only the permission there would let a base-plan org fetch advanced numbers with a URL; trusting the layout protects the page and nothing else.

:::

:::warning[Gotcha]

The README's table says the gates live in `app/api/product-analytics/route-context.ts`. Since ESC-755 that file only binds the page's surface and parameters; `authorizeProducts` is a one-line alias of `authorizeAdvancedPage` in `app/api/_lib/advanced-route-context.ts`, shared with LTV and Inventory. Edit the gate there.

:::

## What is different on this page

- **No Limited variant.** Ads adds a key for the Limited role and the dashboard's snapshot route refuses it. Products has no limited reading, so the role is not in the key and one set of days serves every member of the org.
- **Currency outside the key.** Each day carries both currencies, so switching is a column pick, and the warm-up and the browser plan ask for the product grain without one.
- **Customers need a range entry.** Ads adds every metric from days. Products has two that no day can add up, so it pairs the day cache with the range cache and the table fills in two steps.
- **Range and currency never reload.** The date selector changes the URL with `pushState` and the browser reads the range from it; the currency selector saves the page's own preference (`productAnalyticsCurrency`) and runs no `router.refresh()`. The grain stays a navigation: it is another key.
- **Cross-sell preloaded.** With numbers on screen and the browser idle, the selected product's cross-sell for the range is prefetched under the key the cross-sell hook reads (`use-cross-selling.tsx`), so switching the chart finds it in memory.
- **The kept `loading.tsx`.** The server component still awaits the session, the preferences and the org context, and the loading view draws the frame meanwhile. Its header comment still says it covers "the product report"; stale since ESC-754.

```tsx title="app/(app)/(analytics)/(advanced)/product-analytics/client.tsx · L133–L138"
/** The URL changes in place: Next's search params follow, and the server is not asked for a page. */
const pushUrl = (href: string) => window.history.pushState(null, '', href);
/** The new currency is another column of the same days: there is nothing to refresh. */
const keepPage = () => {};
/** The columns built on the range's customers, which arrive apart from the days (ESC-754). */
const RANGE_TOTALS_COLUMNS: ReadonlySet<string> = new Set(['customers', 'repeat_customers', 'rpr']);
```

## Follow a request

1. **Server** · 9:10, Ana opens the page. `loading.tsx` draws the frame while `page.tsx` checks the reports permission, reads her preferences (Last 7 days, local currency) and the org context, and renders `client.tsx` with no numbers.
2. **Browser** · The range is inside the window, so `client.tsx` asks `/api/product-analytics/days?level=product_id` under `productDaysKey`, unless the browser warm-up already put it in memory.
3. **API route** · `authorizeProducts` passes; `readProductDays` finds every day stored by yesterday's warm-up and answers `mode: 'days'`, `X-Cache: hit`. In `after()`, `warmProductPresets` finds the 12 preset entries already stored.
4. **Browser** · `sumProductDays` builds Nov 10–16 in local currency; `pendingColumns` greys the customer columns until `/api/product-analytics/range-totals?start=2026-11-10&end=2026-11-16` answers from its entry and `applyRangeTotals` fills them. Then `/api/product-analytics/utm-alert` is asked and the banner shows.
5. **Browser** · Last 30 days: `pushUrl` rewrites the URL; the days key is unchanged, so no request. `sumProductDays` re-sums Oct 18–Nov 16; only `range-totals` for that range is asked, a preset, already stored.
6. **Browser → API route** · SKU: a navigation to `?level=sku`, a new key. `readProductDays` holds no SKU days, computes them under the key's lease (`computeProductDays`) and answers `computed`; a second viewer meanwhile gets 202 and asks again in 3 s. `range-totals` at SKU grain is computed too: presets warm at product grain only.
7. **Browser** · USD: the currency selector saves `productAnalyticsCurrency` and calls `keepPage`; `sumProductDays` reads `day.usd` instead of `day.local`. Nothing is fetched. When idle, the cross-sell for the selected SKU in USD is prefetched.

## Where to look

| Role | File |
| --- | --- |
| Keys, peek, range totals, preset warm, live report entry | `app/(app)/(analytics)/(advanced)/product-analytics/days-data.ts` |
| ClickHouse day query (both currencies), customers queries | `lib/server-functions/reporting/product-analytics-days.ts` |
| Wire shape, the one sum, per-currency kept rule | `lib/product-analytics/days/sum-days.ts` |
| Browser keys, endpoints, fetchers (202 retry) | `lib/product-analytics/surface.ts` |
| Frame without numbers; optional seed | `app/(app)/(analytics)/(advanced)/product-analytics/page.tsx` |
| Frame while the server awaits | `app/(app)/(analytics)/(advanced)/product-analytics/loading.tsx` |
| The queries, pushState, currency, cross-sell prefetch | `app/(app)/(analytics)/(advanced)/product-analytics/client.tsx` |
| Cross-sell hook | `app/(app)/(analytics)/(advanced)/product-analytics/use-cross-selling.tsx` |
| The five routes | `app/api/product-analytics/{days,range-days,range-totals,utm-alert,report}/route.ts` |
| Route parameters, window check | `app/api/product-analytics/route-context.ts` |
| Shared gates, 202 helper, slot ceiling | `app/api/_lib/advanced-route-context.ts` |
| UTM alert entry | `lib/server-functions/pixel/utm-alert-status.ts` |
| Pending-column loading cells | `components/product-analytics/products-analytics-table.tsx` |

## Terms

- **`grain`**: How the table groups rows: `product_id`, `variant_id` or `sku`; one day key each. (README: "grano")
- **`scopeParams`**: A grain's key: `PRODUCT_DAYS_CODE_VERSION`, grain, sorted stores, IVA setting. Never range, locale, currency or role.
- **`mode: 'days'` / `mode: 'range-days'`**: The whole window's days, or only their count when over 20,000 rows; then the browser asks per range. (README: "días por rango")
- **`range entry`**: One stored answer of the range cache, keyed by its parameters.
- **`range totals`**: A range's exact customers and repeat customers per product.
- **`pendingColumns`**: Customers, repeat customers and repeat rate, grey until the range totals arrive.
- **`preset warm`**: `warmProductPresets`: the 12 preset entries stored at product grain after a days answer, under the slot ceiling and the 8 s budget.
- **`UTM alert entry`**: The org's campaign status as an hourly, mark-less range entry under the Products surface, read by two pages. (README: "alerta de UTM")
