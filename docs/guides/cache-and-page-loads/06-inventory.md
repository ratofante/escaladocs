---
title: "Inventory"
sidebar_label: "6. Inventory"
sidebar_position: 6
description: "After this chapter you can say, for any number on the three Inventory pages, whether the browser summed it from stored days, the server answered it whole, or it was read live. You can also predict which page movements ask the server and why the first visit of the day still shows a skeleton frame."
---

# Inventory

*After this chapter you can say, for any number on the three Inventory pages, whether the browser summed it from stored days, the server answered it whole, or it was read live. You can also predict which page movements ask the server and why the first visit of the day still shows a skeleton frame.*

<small>~10 min · Built on: ESC-755, ESC-710, docs/features/client-cache/README.md</small>

:::tip[In plain words]

Ana runs the warehouse of a store that sells on Shopify and MercadoLibre. On Sunday, 16 November 2026, at 9:20, she taps Inventory in the sidebar of the app on her phone. The frame arrives at once: header with three tabs, tutorial banner, four stock cards, the items table with its toolbar. Cards and rows are grey blocks for about a second. Then the numbers fill in: 312 items, 41 low on stock, 7 out of stock, and a red dot on the Problems tab.

Three sources feed that screen. The list of items, warehouses and carriers is read fresh every time: it is small and changes only when someone edits it in the app. Each item's balance per warehouse, and the count behind the red dot, come from an answer the server computed earlier and keeps while nothing in the stock ledger moves. The two sales columns are not sent at all: the server sends one row per item, warehouse and day for the whole window, and Ana's phone adds them up. When she switches the range to the last 14 days, nothing is requested; the phone sums again.

At 9:21 she taps History. The page appears with its filters and the first events already listed, no spinner: while she looked at the stock table, her phone fetched the first page of events and the problems list in the background, so the other two tabs open from memory.

:::

## 1. The inventory surface

Every cached page declares which tables its numbers depend on, so a change in those tables can invalidate what is stored. That declaration is a *surface* ([chapter 1](01-the-big-picture.md)). Inventory's watches two tables: the stock ledger, `inventory_event`, which holds every order line consumed, every reversal and every manual set; and `orders`, because a failed ledger line is a problem only while its order is still live. Both carry a *mark* (a per-org fingerprint), so a stored day or entry stays valid while its marks hold. The surface also declares unmarked sources: items, warehouses and carriers come from Postgres tables nobody marks, so its version bumps once an hour and open tabs refetch.

```ts title="lib/cache/surface.ts · L69–L79"
/**
 * ESC-755: the three Inventory pages. `inventory_event` (the ledger) is every balance, sale and
 * problem; `orders` is the join that decides which failed lines are still open problems. Unmarked:
 * the items, warehouses and carriers the stock answer reads from Postgres, which the hourly version
 * bump refreshes in the browser.
 */
export const INVENTORY_SURFACE: CacheSurface = {
  id: 'inventory',
  sources: ['inventory_event', 'orders'],
  hasUnmarkedSources: true,
};
```

:::info[Why this way]

The alternative was to mark the item, warehouse and carrier tables too and store the whole answer. Those tables change only through the app's own writes, after which the page already asks for a fresh answer. The hourly bump covers the rest at no fingerprint cost.

:::

## 2. Sales stored as days

The two sales columns are sums over a range, and sums can be stored per day and added later. So Inventory puts them in the *per-day cache* ([Ads](03-ads.md) covers it in full): one key per org, no currency, one row per item, warehouse and day over the 125-day window. `computeSalesDays` produces a span of days with one ClickHouse query over the ledger: latest version of each event, deleted ones dropped, grouped by the calendar day of `created_at`. The stored value is the *signed* net, units sold minus units reversed that day, which can be negative.

```ts title="lib/server-functions/inventory/inventory-sales-days.ts · L26–L45"
const SALES_DAYS_QUERY = `
  SELECT
      toString(toDate(created_at)) AS date,
      toString(inventory_item_id) AS item_id,
      toString(warehouse_id) AS warehouse_id,
      toInt64(-sum(delta)) AS sold
  FROM (
      SELECT *
      FROM inventory_event
      WHERE org_id = {org_id:String}
        AND event_type IN ('ORDER', 'REVERSAL')
        AND created_at >= parseDateTime64BestEffort({from:String}, 3)
        AND created_at <= parseDateTime64BestEffort({to:String}, 3)
      ORDER BY ingested_at DESC
      LIMIT 1 BY event_id
  )
  WHERE is_deleted = 0
  GROUP BY date, item_id, warehouse_id
  ORDER BY date, item_id, warehouse_id
`;
```

:::info[Why this way]

Days are stored for the whole org, not for a list of items, so an item created tomorrow finds its history. Storing the absolute value per day was rejected: the live read the page always used takes the absolute value of the whole range's sum, and a day with more reversals than orders would otherwise inflate the total.

:::

## 3. The browser sums the range

`GET /api/inventory/sales-days` answers the window's days as compact four-element arrays. The page expands them and runs `sumSalesDays` twice: for "last 30 days" (today minus 29 to today) and for the picked range. The sum groups by item and warehouse, takes the absolute value per warehouse, adds a zero row for each warehouse the item did not sell from, and totals. A range change inside the window is a new sum, not a request. A range that starts before the window falls back to the live read, `GET /api/inventory/sales?start=&end=`, kept in memory per range.

```ts title="lib/inventory/days/sum-sales.ts · L32–L52"
export function sumSalesDays(
  rows: readonly SalesDay[],
  { start, end }: { start: string; end: string },
  warehouseIds: readonly string[] = []
): Record<string, SalesData> {
  const net = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (row.date < start || row.date > end) continue;
    let byWarehouse = net.get(row.itemId);
    if (!byWarehouse) {
      byWarehouse = new Map();
      net.set(row.itemId, byWarehouse);
    }
    byWarehouse.set(row.warehouseId, (byWarehouse.get(row.warehouseId) ?? 0) + row.sold);
  }
  const sales: Record<string, SalesData> = {};
  for (const [itemId, byWarehouse] of net) {
    // The live read orders its rows by warehouse id.
    const warehouses = [...byWarehouse]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([warehouse_id, sold]) => ({ warehouse_id, quantity_sold: Math.abs(sold) }));
```

:::info[Why this way]

The alternative was one range entry per picked range, as the server used to compute it: one ClickHouse query per distinct range and a wait on every range change. Days are computed once and every range inside the window is free.

:::

## 4. Two range entries: stock and problems

Two things cannot be summed from days: each item's balance per warehouse (a running total over the whole ledger) and the list of problems (failed ledger lines joined with live orders). Both go in the *range cache* ([LTV](05-ltv.md) relies on it): one stored entry per key, valid while its marks hold and, for the stock entry, at most one hour. The *stock entry*, built by `computeStock`, holds every active item's balances plus the count behind the Problems badge. The *issues entry*, built by `computeIssues`, holds the Problems tab's rows for the viewer's 30-day window, with the window's first day in its key, so two viewers a calendar day apart each keep a valid entry.

```ts title="app/(app)/(analytics)/(advanced)/inventory/inventory-data.ts · L226–L248"
/** A badge that failed to count is shown as none, as the page always did, and never stored. */
const BADGE_FAILED = -1;

/** The balance of every active item and the problems badge of the viewer's window. */
async function computeStock(orgId: string, today: string): Promise<InventoryStockEntry> {
  const [rows, issuesCount] = await Promise.all([
    activeItemIds(orgId).then((ids) => getInventoryBalanceRows(orgId, ids)),
    getInventoryIssuesCount({ org_id: orgId, since: issuesSince(today) }).catch((error) => {
      console.error('[inventory-stock] issues count failed', { orgId, error });
      return BADGE_FAILED;
    }),
  ]);
  const balances: InventoryBalances = {};
  for (const row of rows) {
    (balances[row.inventory_item_id] ??= []).push([row.warehouse_id, row.quantity]);
  }
  return { balances, issuesCount };
}

const stockCalculation = (orgId: string, today: string) => ({
  compute: () => computeStock(orgId, today),
  isStorable: (entry: InventoryStockEntry) => entry.issuesCount !== BADGE_FAILED,
});
```

:::info[Why this way]

After a write from the app (a manual adjustment, a stock spreadsheet, an item created or deleted, a finished reprocess) the page asks `GET /api/inventory/stock?fresh=1`: the entry is recomputed in the request and stored over the old one, so the saved number is the one on screen. Invalidating instead would show the writer a stale balance right after their own change. The badge rides in the stock entry because every visit needs it; the full list is only needed when the tab opens.

:::

## 5. One answer for three pages

`GET /api/inventory/stock` returns the *stock answer*: the live Postgres half (slim items with id, name, image, channels and rule count; warehouses; carriers; platforms) plus the stock entry. The three pages read it under one query key. History takes its filter options and item names from it, and its first page of events from `GET /api/inventory/events` (ClickHouse, cursor paged). Warehouses takes its data from it and writes its edits back into it, so Stock shows a renamed warehouse without a request. Once any page has its numbers and the browser is idle, `useInventoryPreload` fetches what the other two need, asking only for what the server already holds.

```ts title="components/inventory/use-inventory-queries.ts · L246–L263"
    const run = async () => {
      await preload(inventoryStockKey(scope), () => fetchInventoryStock({ ifCached: true }), true);
      await preload(
        inventorySalesDaysKey(scope),
        () => fetchInventorySalesDays({ ifCached: true }),
        true
      );
      await preload(
        inventoryIssuesKey(scope, { since: issuesSinceOf(today) }),
        () => fetchInventoryIssues({ ifCached: true }),
        false
      );
      await preload(
        inventoryEventsKey(scope, NO_EVENT_FILTERS),
        () => fetchInventoryEvents(NO_EVENT_FILTERS),
        false
      );
    };
```

:::info[Why this way]

The third argument says what also goes to the device: the stock answer and the days persist; problems and events stay in memory. The alternative, three page payloads repeating the shared parts, is what the pages had before. `ifCached` keeps a preload from computing: a 204 leaves the key empty and the page asks for itself when opened.

:::

## 6. The real page as its own loading state

The guide's general rule is that a cached page has no `loading.tsx`: the frame ships at once and each component draws its own skeleton. Inventory keeps its `loading.tsx`, but it renders the page component itself with a `loading` flag, so header, banner, tabs and toolbar are the real ones and only the four numbers and the rows are grey. The server component still awaits the user's preferences and cookies (and, with the staging seed flag, peeks the caches) before it renders, so a boundary is useful; the same component in both states means one frame, never two skeletons in a row.

```tsx title="app/(app)/(analytics)/(advanced)/inventory/client.tsx · L600–L620"
/**
 * The page's loading state (ESC-710): the page itself with `loading`, so the header, banner,
 * section titles, tabs and table toolbar are the real ones and only the numbers and rows are
 * skeletons. `loading.tsx` has no `searchParams`, so the table's range is resolved here from the
 * URL, with the page's own rule (`resolveInventoryDateRange`).
 */
export function InventoryLoadingView({
  today,
  ...props
}: Pick<InventoryClientProps, 'params' | 'canEdit' | 'initialBannerVisible' | 'trialSlot'> & {
  /** The client's calendar day (yyyy-MM-dd), as the page resolves it. */
  today: string;
}) {
  const searchParams = useSearchParams();
  const dateRange = resolveInventoryDateRange(
    searchParams.get('start'),
    searchParams.get('end'),
    today
  );
  return <Client {...props} today={today} dateRange={dateRange} loading />;
}
```

:::info[Why this way]

A `loading.tsx` applies to every route below it. Without its own file, `/inventory/warehouses` would inherit the stock cards and the items table as its frame, then draw cards and carrier rows: two structures in a row. So Warehouses and History each have a one-line `loading.tsx` rendering their own view with `loading`. Deleting all three was rejected while the server components still await per-request reads.

:::

## 7. Warming it without touching ClickHouse

The server warm-up ([chapter 9](09-warm-up.md)) runs an inventory warmer last among the advanced-plan pages. It checks the sales days with `checkDays` and computes missing or stale ones under the warm-up's slot ceiling, then peeks the stock and issues entries for the tick's calendar day and computes whichever is missing or stale. Before any of that, `hasActiveItems` runs one `EXISTS` query in Postgres: an org without items computes nothing and sends no query to ClickHouse. The browser plan's entry `{ kind: 'inventory' }` preloads the stock answer and the sales days with `ifCached=1` for a user with `org:inventory:read` on an advanced org. Problems and events are not in the plan; the pages preload them after painting.

```ts title="lib/server-functions/warmup/warmers.ts · L244–L256"
function inventoryWarmer(orgId: string, today: string, now: number): Warmer {
  return {
    id: 'inventory',
    run: async () => {
      if (!(await hasActiveItems(orgId))) {
        return { daysHit: 0, daysComputed: 0, wholeKeysComputed: 0, rangesStored: 0 };
      }
      const capped = { onlyUnderCap: { ceiling: WARMUP_SLOT_CEILING } };
      const days = await checkDays(salesDaysRequest(orgId, snapshotWindow(now)), now, {
        touch: true,
      });
      const toCompute = days.stale.length + days.missing.length;
      if (toCompute > 0) await readSalesDays(orgId, capped);
```

:::info[Why this way]

Most advanced orgs never open Inventory. Without the shortcut every tick would run a ClickHouse query over an empty ledger for each of them and claim a slot to do it. Gating the warmer on a page visit was rejected: the point of the warm-up is numbers ready before the first visit.

:::

:::warning[Gotcha]

The README's navigation-marks table still lists Inventory with `source: html`, ending "when it stops being `loading`". That row predates ESC-755. The code ends the mark in `client.tsx` with `useNumbersReady(numbersReady, stock.fromDevice ? 'device' : sourceSince(stock.dataUpdatedAt), ...)`, so Inventory now reports `device`, `network` or `memory` like the other cached pages. History ends its own mark on the events query.

:::

## What is different on this page

- **Mixed cache types.** Sales use the per-day cache, balances and problems the range cache, items and warehouses live Postgres. The shape of each number decided its home.
- **A kept `loading.tsx`.** Three loading files, each rendering its own real component with `loading`; Warehouses has one only to avoid inheriting the stock frame.
- **Mark source moved off `html`.** The README says `html`; the code reports `device`, `network` or `memory`.
- **A Postgres-only shortcut in the warm-up.** One `EXISTS` skips the whole warmer for orgs without active items. No other warmer has such a gate.
- **Revalidation without a body.** The hourly bump refetches the stock answer in every open tab, and the largest account's is about 600 KB gzipped. So the `stock`, `sales-days` and `issues` routes answer with an `ETag` that ignores `version`, `checkedAtMs` and `source`; an unchanged answer is a 304 (`conditionalJson`).
- **Two preloaders.** The browser plan preloads stock and days from anywhere in the app; the Inventory pages preload problems and events once their numbers show.

## Follow a request

1. **Browser** · Ana taps Inventory at 9:20; `SidebarLink` starts a `page` mark. Next.js shows `inventory/loading.tsx` (`InventoryLoadingView`, range from the URL) while `page.tsx` awaits `getUserData` and the cookies, then renders `Client` with no numbers.
2. **Browser** · `useInventoryStock` and `useInventorySalesDays` look up `inventoryStockKey(scope)` and `inventorySalesDaysKey(scope)`. First visit of the day: nothing in memory or on the device, so both fetch through `fetchPending`.
3. **API route** · `/api/inventory/stock` passes `authorizeAdvancedPage`, starts the live reads (`readSlimItems`, `getWarehouses`, `getInventoryCarriers`) and in parallel `readStock`, which finds the entry the warm-up stored at 8:40, valid under its marks: no ClickHouse. `conditionalJson` adds the `ETag`.
4. **API route** · `/api/inventory/sales-days` calls `readSalesDays`. `cachedDailyReport` finds every day stored except today's, computes that span with `computeSalesDays` under the key's lease, and answers the rows through `compactSalesDays`.
5. **Browser** · Both answers go to memory and the device. `sumSalesDays` runs twice, `assembleInventoryRows` builds the rows, cards and table fill. `useNumbersReady` ends the mark with `network`.
6. **Browser (idle)** · `useInventoryPreload` runs under `whenIdle`: stock and days are present, so it asks `/api/inventory/issues?ifCached=1` (the warm-up stored it: 200, memory only) and `/api/inventory/events` with no filter.
7. **Browser** · At 9:21 Ana taps History. `history/page.tsx` sends the frame; `history/client.tsx` reads the stock answer and `inventoryEventsKey(scope, filters)` from memory. No request leaves; its mark ends with `memory`.
8. **Browser, later** · At 10:30 the hourly bump arrives through the `/api/cache/versions` poll; `useInventoryVersion` refetches in the background and the stock route answers 304 to a matching `If-None-Match`.

## Where to look

| Role | File |
| --- | --- |
| The surface: watched tables, unmarked flag | `lib/cache/surface.ts` |
| Day request, stock and issues entries, peeks, refresh, EXISTS shortcut | `app/(app)/(analytics)/(advanced)/inventory/inventory-data.ts` |
| ClickHouse query for a span of sales days | `lib/server-functions/inventory/inventory-sales-days.ts` |
| Summing days in the browser, rebuilding rows | `lib/inventory/days/sum-sales.ts` |
| Keys, endpoints, fetchers, wire shapes (client-safe) | `lib/inventory/surface.ts` |
| Shared queries, version refetch, fresh refresh, idle preload | `components/inventory/use-inventory-queries.ts` |
| Routes: stock answer, sales days, live range, problems, catalogue search | `app/api/inventory/{stock,sales-days,sales,issues,channel-products}/route.ts` |
| Events, cursor paged, ClickHouse | `app/api/inventory/events/route.tsx` |
| ETag and 304 for the cached routes | `app/api/inventory/_lib/conditional-json.ts` |
| Stock page: frame only, client with sums and mark, loading state | `app/(app)/(analytics)/(advanced)/inventory/{page,client,loading}.tsx` |
| History and Warehouses: page, client, own loading boundary | `app/(app)/(analytics)/(advanced)/inventory/{history,warehouses}/{page,client,loading}.tsx` |
| Server warm-up: the inventory warmer | `lib/server-functions/warmup/warmers.ts` |
| Browser plan entry and its fetches | `lib/cache/warmup-plan.ts`, `lib/cache/use-warmup.ts` |
| Mark source helpers | `lib/perf/navigation-marks.ts` |

## Terms

- **`stock answer`**: What `GET /api/inventory/stock` returns: live items, warehouses, carriers and platforms plus the stock entry; one key shared by three pages. (README: "respuesta de stock")
- **`slim item`**: An active item as the table shows it: id, name, image, channels, rule count. No rules, no sales.
- **`sales days`**: One row per item, warehouse and day with the signed net units, in the per-day cache. (README: "días de ventas")
- **`stock entry`**: Range-cache entry: every active item's balance per warehouse plus the badge count; at most one hour.
- **`issues entry`**: Range-cache entry with the Problems tab's rows for a 30-day window whose first day is in the key. (README: "problemas")
- **`ledger`**: The `inventory_event` table: every sale, reversal and manual set.
- **`ifCached=1`**: A read-only ask: never computes, 204 when nothing is stored, computation queued after the response.
- **`fresh=1`**: After a write from the app: computed in the request and stored over whatever was there.
