---
title: "The report page"
sidebar_label: "4. The report page"
sidebar_position: 4
description: "How the report page keeps every choice in its address, turns that choice into one request for every view, and draws the gallery, the filters, the metrics and the two charts from it."
---

# The report page

*After this chapter you can predict what happens when a user changes anything on the report page: which choice changes, what the address becomes and which request leaves. You can also say why a copied link shows the same page, and where to add a filter, a grouping or a metric.*

<small>~10 min · Built on: ESC-799, docs/features/creatives/README.md</small>

:::tip[In simple terms]

The report page shows one report in three ways: a gallery of cards, a bar chart over a table, and a daily line chart over the same table. Above them the user picks a range, filters, a grouping, the metrics, the order and the view.

These choices form one record, and the record lives in the page's address. Every control writes its change there, and every part of the page reads it back. So a reload, the back button or a shared link shows the same report. A change that asks for other rows, such as a new filter, also goes back to the first page.

One function turns the record into the question for the server. The gallery, the table and the daily chart all start from it, so a new filter reaches all three.

The gallery shows 8 or 12 cards per page. A video plays, and is requested, only when the pointer rests on its card. Filters and groupings come from fixed lists, in a panel that opens next to its button on a computer and from the bottom on a phone.

In the chart views the table chooses what the chart draws: each ticked row is one series, up to ten. The ticks live in memory and start over when the range, grouping or filters change.

:::

## 1. One state, kept in the address

Everything the user chose is one object: range, metrics in order, sort and direction, view, page and size, grouping, filters and the order they were applied in. The address is its only copy: a control keeps no value of its own.

In the code, the object is `CreativeReportState`. `useCreativeReportState` derives it from the search params on every render and writes a change with `history.pushState`, which Next's `useSearchParams` follows without a server request (`components/creatives/report-state.ts · L540–L571`). The toolbar and the content card both call it (`components/creatives/report-toolbar.tsx · L27`, `components/creatives/report-body.tsx · L73`). Their defaults, the server's range and the role's metrics, come from one provider (`components/creatives/creatives-report.tsx · L103–L118`), fed by the server page (`app/(app)/(analytics)/creatives/report/page.tsx · L25–L53`).

```ts title="components/creatives/report-state.ts · L83–L108"
export type CreativeReportState = {
  /** The range, calendar days `YYYY-MM-DD`. */
  start: string;
  end: string;
  …
  datePreset?: DatePreset;
  /** The chosen metrics, in order: 1 to `MAX_CREATIVE_METRICS` ids of the offered list. */
  metrics: string[];
  /** The metric the report is sorted by, and its direction. */
  sort: string;
  dir: CreativeSortDirection;
  view: CreativeReportView;
  /** 0-based page of the gallery. */
  page: number;
  pageSize: CreativePageSize;
  /** "Agrupar": what one row (one card) of the report is. */
  group: CreativeGrouping;
  /** The applied filters (AND between them, OR inside one). */
  filters: CreativeReportFilters;
  /** The applied filters' kinds, oldest first: the chips' order and "the last filter". */
  filterOrder: CreativeFilterKind[];
};
```

`parseReportState` checks every value against what the session is offered, and drops a verdict filter for a Limited session (`L294–L351`, `L175`). `serializeReportState` leaves defaults out and writes the filters last, in applied order (`L358–L390`). The address also carries `report`, the open report (`L128–L129`), and `preset`, a relative range (`L87–L92`); both are explained in [Reports](./05-reports.md).

Every change goes through one function:

```ts title="components/creatives/report-state.ts · L416–L444"
/** A change to any of these asks for other rows: the gallery goes back to its first page. */
const RESETS_PAGE: readonly (keyof CreativeReportState)[] = [
  'start',
  'end',
  'sort',
  'dir',
  'pageSize',
  'group',
  'filters',
];

/** The state after `patch`, with the page reset when the rows it pages through change. */
export function applyReportPatch(
  state: CreativeReportState,
  patch: Partial<CreativeReportState>,
  today: string = localToday()
): CreativeReportState {
  const next = { ...state, ...patch };
  const resets = RESETS_PAGE.some((key) => key in patch && patch[key] !== state[key]);
  if (resets && !('page' in patch)) next.page = 0;
  …
  if ('filters' in patch && !('filterOrder' in patch)) {
    next.filterOrder = nextFilterOrder(state.filterOrder, next.filters);
  }
  return next;
}
```

Note what the list leaves out: `metrics` and `view` keep the page. The date selector builds its own address, so it goes through `navigate`, which calls `update` with the dates (`L578–L585`, `report-toolbar.tsx · L64–L71`).

:::info[Why this way]

A store mirrored to the address was the alternative: two copies, an effect to keep them equal, and a render where they disagree. With one copy, the toolbar, the controls and the views cannot disagree, and back and forward work.

:::

## 2. From state to request

The server knows nothing about views: it answers a page of rows for a range, an order, a grouping and filters. One function builds that question for every view.

In the code, that function is `reportRequestParams`. A list is a repeated parameter (`report-state.ts · L259–L266`); [The report data](./03-the-report-data.md) says why. The metrics are not sent: the route returns every metric of a row, so changing the card's metrics asks for nothing.

```ts title="components/creatives/report-state.ts · L392–L414"
/**
 * What the creative report route is asked for this state (`GET /api/creatives/report`): the
 * range, order and page, then `group` (left out for the default) and the filters, lists as
 * repeated params, in the menu's fixed order so the same filters are the same cached request.
 * The daily route reads the same string (it ignores `sort`, `dir`, `limit`, `offset`).
 */
export function reportRequestParams(state: CreativeReportState, currency: string): URLSearchParams {
  const params = new URLSearchParams({
    start: state.start,
    end: state.end,
    currency,
    sort: state.sort,
    dir: state.dir,
    limit: String(state.pageSize),
    offset: String(state.page * state.pageSize),
  });
  const group = state.group ?? CREATIVE_DEFAULT_GROUP;
  if (group !== CREATIVE_DEFAULT_GROUP) params.set('group', group);
  const filters = state.filters ?? NO_FILTERS;
  const today = localToday();
  for (const kind of appliedFilterKinds(filters)) appendFilter(params, filters, kind, today);
  return params;
}
```

The request lists filters in the menu's fixed order (`components/creatives/report-filters.ts · L70–L73`), the address in applied order. So the same filters applied in another order hit the same cache entry. "Launched in the last N days" stays `launch_days` in the address and becomes two dates on the viewer's today (`report-state.ts · L274–L285`).

`ReportBody` sends it through TanStack Query, one entry per organization and string, fresh for five minutes (`components/creatives/report-data.ts · L38–L49`, `report-body.tsx · L53–L54`, `L87–L103`). It also draws the states: no Meta account, with no request (`L118–L131`); a failure with "Reintentar" (`L132–L145`); skeleton cards while loading, the pagination keeping the last total (`L105–L107`); an empty range (`components/creatives/gallery-view.tsx · L50–L56`); a note under 50% coverage (`report-body.tsx · L180–L184`); and the remainder line (`L192–L196`).

:::info[Why this way]

Each view building its own request was the alternative: three copies of the filters, drifting with the first new one. With one function, a new parameter reaches every view at once.

:::

## 3. The gallery and its cards

Galería shows one card per row, 8 per page or 12. A card shows the picture with a format badge, the name, one line per chosen metric (up to 4), the verdict and "N ventas". Without a picture it shows its format's icon and "Sin vista previa". A grouped card shows the group's title, its top creative's media and "N creativos".

In the code, `GalleryView` draws the grid and the pagination, which calls `update` (`gallery-view.tsx · L61–L99`). `CreativeCard` titles the row with `useGroupTitle` (`components/creatives/creative-card.tsx · L81–L113`), falls back to `MediaPlaceholder` (`L217–L222`) and picks the footer count by grouping (`L267–L272`). Its `VERDICT_LABEL` maps `break_even` to the message key `verdict.borderline` (`L69–L74`): the key kept its first name, the value is gone.

After the pointer rests 300 ms on a video card, never on a touch, the card mounts `CardVideo` (`L51–L52`, `L196–L204`, `L223–L225`). It asks the existing ad preview route for the row's `top_ad_id`, through the Customer Journey's preview cache, and plays muted and looped (`components/creatives/card-video.tsx · L46–L52`, `L79–L94`). Anything but a video makes the card stop asking. The route lets the Limited role in for an ad's media:

```ts title="app/api/pixel/ad-preview/route.ts · L40–L61"
/**
 …
 * The Limited reports role may also ask for an AD's preview: the Creativos gallery plays a video on
 * hover for every role that can open it (ESC-799), and an ad's own media reveals nothing about the
 * store's margin. It gets no Klaviyo email: those belong to the Customer Journey page, which that
 * role cannot open.
 */
export async function GET(req: Request) {
  const { orgId, has } = await auth();
  const canRead =
    has?.({ permission: PERMISSIONS.PIXEL_READ }) ||
    has?.({ permission: PERMISSIONS.REPORTS_READ });
  const canReadAds = canRead || has?.({ permission: PERMISSIONS.REPORTS_READ_LIMITED });
  if (!orgId || !canReadAds) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
```

:::info[Why this way]

Asking for every visible card's video was the alternative: one request per card, for files whose addresses expire. Asking on rest costs one per card the user looks at. It starts muted because a hover is not a gesture, and the player's autoplay with sound would be refused (`card-video.tsx · L13–L16`).

:::

## 4. Filters and grouping

"Filtro" opens a fixed list of eight filters. The Limited role never sees the verdict. AND applies between filters, OR inside one. A list applies on each tick; a text, an amount or a date on "Aplicar". Applied filters show as chips, oldest first. When nothing matches, the card names the last filter applied and offers to remove only it. "Agrupar" offers nine groupings.

In the code, the kinds and their address parameters are one table:

```ts title="components/creatives/report-filters.ts · L12–L43"
/** The filters of the "Filtro" menu, in its order. Veredicto is never offered to Limited. */
export const CREATIVE_FILTER_KINDS = [
  'status',
  'format',
  'campaign',
  'adset',
  'name',
  'spend',
  'launch',
  'verdict',
] as const;
…
/** The address parameters each kind writes (the report route's names). */
export const FILTER_PARAMS: Record<CreativeFilterKind, readonly string[]> = {
  status: ['status'],
  format: ['format'],
  campaign: ['campaign'],
  adset: ['adset'],
  name: ['name'],
  spend: ['spend_min', 'spend_max'],
  launch: ['launch_from', 'launch_to', 'launch_days'],
  verdict: ['verdict'],
};
```

`nextFilterOrder` keeps applied kinds in place and puts a new one last (`L103–L116`). The order is never stored on its own: `parseFilterOrder` reads it from the order of the parameters (`report-state.ts · L203–L214`). The chips follow it (`components/creatives/filter-chips.tsx · L180–L197`), and its last kind is the no-match message's (`report-body.tsx · L111–L114`, `L146–L162`). `useFilterSummary` words every filter (`filter-chips.tsx · L40–L55`). The editors are in `components/creatives/filter-editors.tsx`; `FilterMenu` hides the verdict from Limited (`components/creatives/filter-menu.tsx · L77`); `GroupMenu` lists `CREATIVE_GROUPINGS` (`components/creatives/group-menu.tsx · L57–L75`). Every panel, the metric picker included, is a `ResponsivePanel`: a popover, or a bottom sheet below 768 px (`components/creatives/responsive-panel.tsx · L61–L101`).

To add a filter: its kind and parameters in that table, its cases in `isFilterApplied` and `withoutFilter`, `parseFilters` and `appendFilter`, an editor, a wording, and the route's filter. A grouping is a value of `CREATIVE_GROUPINGS` (`lib/server-functions/creatives/get-creative-report.schema.ts · L88–L98`) plus its title in `useGroupTitle`.

:::info[Why this way]

A separate filter store was the alternative: two copies of the state. The order rides on the parameters' order, not on a hidden parameter kept in step. One panel with two shells beat writing each menu twice; it holds no Radix menu items, which work only inside a menu (`responsive-panel.tsx · L10`).

:::

## 5. Metrics

A report has one ordered list of metrics, at most 4, and each view draws from its front. A metric's colour is its position's, on the chip, the card and the chart. The picker shows the chosen metrics numbered, with up, down and remove, and the offered ones in five groups.

In the code:

```ts title="components/creatives/report-controls.tsx · L19–L27"
/**
 * How many of the ordered metrics each view draws as chips (Figma Final): Galería up to 4,
 * Totales the first 2 (the bars), Diario the first (the line). The list itself keeps all of them.
 */
const VISIBLE_METRICS: Record<CreativeReportView, number> = {
  gallery: MAX_CREATIVE_METRICS,
  totals: 2,
  daily: 1,
};
```

`MetricChips` draws that many chips plus "+ Métrica", or "Métricas (N)" on a phone (`components/creatives/metric-chips.tsx · L177–L184`). The picker refuses a fifth and keeps one (`components/creatives/metric-picker.tsx · L125–L127`, `L150–L156`). Offered means the route's sort metrics the registry knows, minus `LIMITED_HIDDEN_PIXEL_COLUMNS` for Limited, so that role never sees estimated profit or another margin-based metric (`components/creatives/metric-options.ts · L46–L57`). `creativeMetricGroup` puts each metric in a group, Conversión (Meta) by default (`L74–L123`). A new metric shows up once the route returns it and the registry knows it.

:::info[Why this way]

A list per view was the alternative. One list means one picker, one field in a saved report, and an order that survives a switch of view. Colour by position keeps one slot one colour whatever metric fills it (`metric-options.ts · L9–L10`).

:::

## 6. Totales and Diario

Both views put a chart over a table of the report's rows, 10 per page. A ticked row is a series: bars in Totales, a line in Diario. At most 10; Totales starts with the first page ticked, Diario with the first 5. A ticked row keeps its colour slot. Ticks, page and search stay in memory and start over when range, currency, grouping or filters change.

In the code, the charts start from `reportRequestParams` too. The scope is that request without order, page and search:

```ts title="components/creatives/charts/chart-data.ts · L45–L66"
/** The report's range, currency, grouping and filters, as a stable string. */
export function chartScopeParams(state: CreativeReportState, currency: string): URLSearchParams {
  const params = reportRequestParams(state, currency);
  for (const name of NOT_SCOPE) params.delete(name);
  params.sort();
  return params;
}

/** The table's page of the report: the page's request with 10 rows at `page`, and the search. */
export function tableRowsParams(
  state: CreativeReportState,
  currency: string,
  page: number,
  search: string
): URLSearchParams {
  const params = reportRequestParams(state, currency);
  params.set('limit', String(CHART_TABLE_PAGE_SIZE));
  params.set('offset', String(page * CHART_TABLE_PAGE_SIZE));
  const name = search.trim();
  if (name) params.set('name', name.slice(0, 200));
  return params;
}
```

`ChartReportView` asks for the page on screen and the scope's first page, which seeds the ticks (`components/creatives/charts/chart-report-view.tsx · L127–L135`). `useChartSelection` reseeds during render when the scope changes (`components/creatives/charts/chart-selection.ts · L146–L171`), with the limits in `CHART_MAX_SERIES` and `CHART_DEFAULT_SERIES` (`L30–L33`). Totales draws its bars from the ticked rows (`components/creatives/charts/totals-bar-chart.tsx · L69–L77`). Diario asks `GET /api/creatives/daily` for the first metric, one `key` per tick (`chart-data.ts · L68–L80`), and draws the keys still ticked (`components/creatives/charts/daily-line-chart.tsx · L50–L60`). A header click changes the report's own order through `update` (`components/creatives/charts/chart-table.tsx · L332–L339`). Switching views mounts another component, so the ticks reset (`components/creatives/report-view.tsx · L30–L39`).

The table sits under the content card, outside its border, but its state stays in the view. The body renders an empty outlet there (`report-body.tsx · L185`, `L199–L204`), and the view wraps its table in:

```tsx title="components/creatives/charts/chart-table-slot.tsx · L23–L28"
export function ChartTableOutlet({ children }: { children: ReactNode }) {
  const slot = useContext(ChartTableSlotContext);
  if (slot === undefined) return <>{children}</>;
  if (slot === null) return null;
  return createPortal(children, slot);
}
```

:::info[Why this way]

The ticks stay out of the address because 10 keys of up to 2,000 characters do not fit there (`docs/features/creatives/README.md`). For the table's place, the alternatives were the body drawing its card twice, or rendering the chart view itself and bypassing the view switch. A portal moves only the table's DOM.

:::

:::warning[Gotcha]

The table's search and the "Nombre contiene" filter share the route's single `name`. While the search has text it overwrites the filter (`chart-data.ts · L63–L64`): the table's rows ignore the filter while its chip still shows. The default ticks and Diario still carry it.

:::

:::warning[Gotcha]

In Totales and Diario the body sends no request of its own. It reads the charts' first table page under the charts' cache key, `['creatives', 'charts', 'rows', …]` (`report-body.tsx · L87–L103`, `chart-data.ts · L88–L98`), for its total, no-match message and remainder line. Change one key and not the other, and the page costs one extra request.

:::

## Follow a request

A full reader on page 2 of Galería ticks "Activo" under Estado. The server side is in [The report data](./03-the-report-data.md).

1. **Browser** · The status editor sends `status: ['active']` and the toolbar calls `update({ filters })` (`filter-editors.tsx · L118–L123`, `report-toolbar.tsx · L38`).
2. **`applyReportPatch`** · `filters` resets `page` to 0; `nextFilterOrder` puts `status` last.
3. **`serializeReportState`** · `page` leaves the address, `status=active` goes last, `history.pushState` pushes it.
4. **`useCreativeReportState`** · Toolbar and body derive the new state: chip "Estado: Activo".
5. **`ReportBody`** · `reportRequestParams` gives `offset=0&status=active`, a new cache key, so `GET /api/creatives/report` leaves.
6. **`GalleryView`** · Skeleton cards; the pagination keeps the last total.
7. **`GalleryView`** · The answer replaces the skeletons. With `total` 0 the body shows "Ningún creativo cumple estos filtros", naming Estado.

## Where to look

| Role | File |
| --- | --- |
| Current behaviour, the ticks' size limit | `docs/features/creatives/README.md` |
| Server page: permission, range, role | `app/(app)/(analytics)/creatives/report/page.tsx` |
| Page in the browser, defaults provider | `components/creatives/creatives-report.tsx` |
| State, address, request, page reset | `components/creatives/report-state.ts` |
| Report request and cache key | `components/creatives/report-data.ts` |
| Content card, states, table outlet | `components/creatives/report-body.tsx` |
| Subheader: chips, Filtro, Agrupar, dates | `components/creatives/report-toolbar.tsx` |
| Metric chips, order, view switch row | `components/creatives/report-controls.tsx` |
| The switch between views | `components/creatives/report-view.tsx` |
| `ReportMessage`, the shape of every message (four importers; the file name is from a removed placeholder) | `components/creatives/view-coming-soon.tsx` |
| Galería grid and pagination | `components/creatives/gallery-view.tsx` |
| Card, group title, hover timer | `components/creatives/creative-card.tsx` |
| Hover video | `components/creatives/card-video.tsx` |
| Preview route, Limited rule | `app/api/pixel/ad-preview/route.ts` |
| Filter kinds, parameters, order | `components/creatives/report-filters.ts` |
| Filter list | `components/creatives/filter-menu.tsx` |
| Chips, `useFilterSummary` | `components/creatives/filter-chips.tsx` |
| One editor per filter | `components/creatives/filter-editors.tsx` |
| Agrupar | `components/creatives/group-menu.tsx` |
| The groupings | `lib/server-functions/creatives/get-creative-report.schema.ts` |
| Popover or bottom sheet | `components/creatives/responsive-panel.tsx` |
| Offered metrics, groups, labels | `components/creatives/metric-options.ts` |
| Metric picker | `components/creatives/metric-picker.tsx` |
| Metric chips | `components/creatives/metric-chips.tsx` |
| Totales and Diario: layout, queries, states | `components/creatives/charts/chart-report-view.tsx` |
| Chart requests, scope | `components/creatives/charts/chart-data.ts` |
| Ticks, slots, defaults | `components/creatives/charts/chart-selection.ts` |
| Table under the charts | `components/creatives/charts/chart-table.tsx` |
| Outlet and portal | `components/creatives/charts/chart-table-slot.tsx` |
| Bar chart | `components/creatives/charts/totals-bar-chart.tsx` |
| Line chart | `components/creatives/charts/daily-line-chart.tsx` |

## Terms

- **state**: Everything the user chose on the report page; its only copy is the address.
- **patch**: The part of the state a control changes; `applyReportPatch` merges it.
- **offered metrics**: What a session may choose or sort by; Limited gets no margin-based metric.
- **slot**: A position in the metric list or among the ticks; it gives the colour.
- **last filter**: The most recently applied filter, named when nothing matches. (UI: "Quitar el último filtro")
- **panel**: A menu's content, as a popover on a desktop or a bottom sheet on a phone.
- **scope**: The charts' request without order, page and search; a change resets the ticks.
- **selection**: The ticked rows of Totales or Diario, at most 10, in memory per view.
- **outlet**: The empty element under the content card that receives the charts' table.
