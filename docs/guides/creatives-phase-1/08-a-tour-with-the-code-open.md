---
title: "A tour with the code open"
sidebar_label: "8. A tour with the code open"
sidebar_position: 8
description: "A walk through Creativos in the order you look and click, naming at each stop the file that draws it, the request it sends and the server file that answers."
---

# A tour with the code open

_After this walk you can point at any part of Creativos and open the file that draws it, the request it sends and the server code that answers. You can also read each request in DevTools and say why it left, or why nothing left._

:::tip[How to take this tour]

Open the staging preview in one window and the app repository in your editor in the other. In DevTools, filter the Network tab by `api/creatives`: every request of this feature matches it. The one other request worth watching is the video a card plays on hover: filter by `ad-preview` to see it.

Saved reports need migration 036, which may not be run yet. The stops that need it say so.

Each stop has three parts. **On screen**: what to look at and do. **In the code**: which file to open and what happens there. **In the Network tab**: which request leaves, or why none does.

:::

## The route map

Every request the page can send. Paths are from the app repository's root.

| On screen | Sent from | Request | Answered by |
| --- | --- | --- | --- |
| The gallery's saved reports, favourites and recents, on first paint | `app/(app)/(analytics)/creatives/page.tsx · L25` | none from the browser: the server page reads Postgres | `app/(app)/(analytics)/creatives/load-saved-reports.ts · L12–L33` → `lib/server-functions/creatives/list-creative-saved-reports.ts · L21–L92` |
| The same list, only when the server's read failed | `components/creatives/reports/saved-reports.ts · L80–L89`, `L119–L128` | `GET /api/creatives/reports` | `app/api/creatives/reports/route.ts · L25–L36` |
| The cards of Galería | `components/creatives/report-body.tsx · L92–L103` → `components/creatives/report-data.ts · L42–L49` | `GET /api/creatives/report`, `limit` 8 or 12 | `app/api/creatives/report/route.ts · L23–L63` → `lib/server-functions/creatives/get-creative-report.ts · L445–L465` |
| The table of Totales and Diario, and the body's total in those views | `components/creatives/charts/chart-data.ts · L54–L66`, `L89–L98` | `GET /api/creatives/report`, `limit=10`, plus `name` while the table search has text | same as above |
| The line chart of Diario | `chart-data.ts · L69–L80`, `L105–L129` | `GET /api/creatives/daily` with `metric` and 1 to 10 `key` | `app/api/creatives/daily/route.ts · L21–L59` → `lib/server-functions/creatives/get-creative-daily.ts · L31–L73` |
| Campaña and Conjunto editors, and a chip that names one campaign or ad set | `report-data.ts · L69–L78`, used by `components/creatives/filter-editors.tsx · L140` and `components/creatives/filter-chips.tsx · L58–L59` | `GET /api/creatives/options?start=…&end=…` | `app/api/creatives/options/route.ts · L16–L35` → `lib/server-functions/creatives/get-creative-filter-options.ts · L56–L85` |
| A video playing on hover | `components/creatives/card-video.tsx · L79–L94` → `lib/customer-journey/ad-preview-client.ts · L80–L82` | `GET /api/pixel/ad-preview?platform=meta&id=<ad id>` | `app/api/pixel/ad-preview/route.ts · L53–L96` |
| Opening a report, once per report (after 036) | `components/creatives/creatives-report.tsx · L60–L76` → `saved-reports.ts · L106–L107` | `POST /api/creatives/reports/<id>/open` | `app/api/creatives/reports/[id]/open/route.ts · L14–L33` |
| "Guardar" on a ready-made, new or plain report, and "Guardar como reporte nuevo" (after 036) | `components/creatives/report-header.tsx · L99–L106` → `components/creatives/reports/saved-reports-provider.tsx · L253–L261` | `POST /api/creatives/reports`, body `{ name, config }` | `app/api/creatives/reports/route.ts · L42–L61` → `lib/server-functions/creatives/create-creative-saved-report.ts · L28–L47` |
| "Guardar" over a saved report with changes (after 036) | `report-header.tsx · L102–L106` → `saved-reports-provider.tsx · L181–L198` | `PATCH /api/creatives/reports/<id>`, body `{ config }` | `app/api/creatives/reports/[id]/route.ts · L52–L84` |
| "Renombrar", on a card or in the header's "···" (after 036) | `saved-reports-provider.tsx · L262–L267` | `PATCH /api/creatives/reports/<id>`, body `{ name }` | same as above |
| "Eliminar reporte" (after 036) | `saved-reports-provider.tsx · L270–L283` | `DELETE /api/creatives/reports/<id>` | `app/api/creatives/reports/[id]/route.ts · L87–L103` |
| The star, on a card or in the switcher (after 036) | `saved-reports-provider.tsx · L200–L211` → `saved-reports.ts · L100–L104` | `PUT` to star, `DELETE` to unstar, `/api/creatives/reports/<id>/favorite` | `app/api/creatives/reports/[id]/favorite/route.ts · L14–L46` |
| A new date range (outside the `api/creatives` filter) | `components/ds/date-range-selector.tsx · L496` → `components/providers/preferences-provider.tsx · L56–L57` | `POST /api/user/preferences` | `app/api/user/preferences/route.ts · L15` |

## Stop 1 · The sidebar entry

**On screen.** "Creativos" in the sidebar. Click it: the address becomes `/creatives`.

**In the code.** The entry is one item of the sidebar's list, with no plan gate.

```tsx title="components/app/app-sidebar.tsx · L164–L171"
    // ESC-799: on every plan (no Advanced gate), for both report roles (`ROUTE_PERMISSIONS`). The
    // gallery of reports; the report page under it keeps the entry active (longest prefix).
    {
      label: t('creatives'),
      href: '/creatives',
      icon: <GalleryVerticalEnd />,
      hasPermission: false,
    },
```

Who sees it comes from a map of routes to permissions: both Creativos routes accept the full reports permission or the Limited one (`lib/permissions.tsx · L36–L38`). The app shell turns the map into a yes or no per address (`components/app/app-shell-layout.tsx · L80–L84`), and the sidebar hides an entry that got a no (`app-sidebar.tsx · L297–L307`).

**In the Network tab.** Nothing under `api/creatives`: the click is a page navigation.

## Stop 2 · The gallery of reports loads

**On screen.** The title, a search box, "Nuevo reporte" and groups of cards. Without migration 036 there is one group, "Todos los reportes", and "Nuevo reporte" is disabled with "Los reportes guardados todavía no están disponibles."

**In the code.** `app/(app)/(analytics)/creatives/page.tsx` is a server component: it runs before the browser gets any HTML. It checks the permission and the role, and reads the saved reports (`L17–L27`). That read, `loadSavedReports`, never throws. It returns a snapshot, a small record in one of three states:

```ts title="app/(app)/(analytics)/creatives/load-saved-reports.ts · L17–L32"
  if (!caller.userId) return { status: 'error' };
  try {
    const list = await listCreativeSavedReports({
      orgId: caller.orgId,
      userId: caller.userId,
      isLimited: caller.isLimited,
    });
    return { status: 'ready', list };
  } catch (error) {
    if (error instanceof CreativeSavedReportsUnavailableError) return { status: 'unavailable' };
    console.warn('[creatives-saved-reports] list failed on the server page', {
      orgId: caller.orgId,
      error,
    });
    return { status: 'error' };
  }
```

The client component `ReportGallery` mounts `SavedReportsProvider`, one context with the list and every save action (`components/creatives/reports/report-gallery.tsx · L44–L50`, `components/creatives/reports/saved-reports-provider.tsx · L122–L303`). The snapshot seeds TanStack Query's cache unless it is `error` (`components/creatives/reports/saved-reports.ts · L119–L128`).

"Only Todos los reportes" is decided here. With `unavailable`, the personal groups get no lists (`saved-reports-provider.tsx · L141–L149`, `L161–L164`), and an empty group renders nothing (`components/creatives/reports/report-section.tsx · L28–L29`). `ActionHint` gives the disabled "Nuevo reporte" its tooltip (`report-gallery.tsx · L52–L63`).

**In the Network tab.** Usually nothing: the list came inside the page and stays fresh five minutes (`saved-reports.ts · L112–L113`). Only after a failed server read does the browser ask `GET /api/creatives/reports`, and a 503 there is a state, not an error (`L80–L89`).

More: [Reports](./05-reports.md#7-before-the-migration-runs).

## Stop 3 · The cards and the search

**On screen.** Twelve cards, eight for a Limited member: a colour mark, an icon, a name, a line of description, three grey tiles. Type "mas inv" in the search.

**In the code.** The twelve reports are not in the database. Their definitions are a fixed array, `CREATIVE_READY_MADE_REPORTS` (`lib/server-functions/creatives/report-config.schema.ts · L224–L294`). Their icons and colours are a table keyed by id (`components/creatives/reports/ready-made-reports.ts · L40–L54`). Their texts are message keys built from the id. One hook joins the three:

```ts title="components/creatives/reports/report-list.ts · L66–L81"
/** The ready-made reports the role may open, named in the viewer's language. */
export function useReadyMadeItems(isLimited: boolean): CreativeReportListItem[] {
  const t = useTranslations('creatives.reports');
  return useMemo(
    () =>
      readyMadeReports(isLimited).map(({ id, icon, color }) => ({
        id,
        kind: 'ready-made' as const,
        name: t(`names.${id}`),
        description: t(`descriptions.${id}`),
        icon,
        color,
      })),
    [isLimited, t]
  );
}
```

`ReportCard` draws it (`components/creatives/reports/report-card.tsx · L117–L184`). Its tiles are placeholders on purpose: filling them would cost one request per card (`L9–L10`). A saved report's colour and icon come from a hash of its id (`components/creatives/reports/saved-report-items.ts · L60–L67`).

The search is local state, matched ignoring case and accents (`report-gallery.tsx · L77–L79`, `report-list.ts · L61–L64`, `L87–L112`). No match shows "Ningún reporte coincide con tu búsqueda" through `ReportMessage`, the shape of every message of the feature. It lives in `view-coming-soon.tsx`, a name left from a removed placeholder (`components/creatives/view-coming-soon.tsx · L3–L8`).

**In the Network tab.** Nothing: it all lives in the browser.

## Stop 4 · Opening a report

**On screen.** Click "Top Hooks". The address becomes `/creatives/report?report=top-hooks`, and a moment later gains `start` and `end`.

**In the code.** The card links to `reportHref`, the report page with only the id (`report-list.ts · L56–L59`). The server page `app/(app)/(analytics)/creatives/report/page.tsx` reads the organization's context, the user's preferences and the saved reports at once, resolves a default range, and hands it all to the client (`L25–L54`).

In the browser, `CreativesReport` mounts the saved-reports provider and builds the page's defaults (`components/creatives/creatives-report.tsx · L52–L58`). The one that matters here is `definition`: given an id, it returns that report's configuration.

```tsx title="components/creatives/creatives-report.tsx · L91–L101"
  const defaults = useMemo(() => {
    const readyMade = readyMadeDefinition(isLimited);
    const fromProps = new Map((savedDefinitions ?? []).map(({ id, config }) => [id, config]));
    return {
      ...creativeReportDefaults(initialStart, initialEnd, isLimited),
      definition: (id: string) =>
        id === NEW_REPORT_ID
          ? readyMade(DEFAULT_READY_MADE_REPORT)
          : (readyMade(id) ?? savedConfigs.get(id) ?? fromProps.get(id)),
    };
  }, [initialStart, initialEnd, isLimited, savedDefinitions, savedConfigs]);
```

The page state has no store. `useCreativeReportState` derives it from the address on every render, with `stateFromAddress` (`components/creatives/report-state.ts · L554–L588`, `L509–L519`). With a `report` and no `sort`, `stateFromReportConfig` loads the definition, its preset resolved on today (`L452–L482`). The first render already carries the report.

:::warning[An address with a report but no sort means "the report as defined"]

`sort` is the sign that the page wrote the address, and next to a report the page always writes it (`report-state.ts · L373–L376`). It cannot be `start`: the date selector writes the range on mount (`components/ds/date-range-selector.tsx · L505–L516`). Edit an address by hand and leave out `sort`, and everything else you typed is ignored.

:::

**In the Network tab.** The report request of the next stop. After migration 036, also `POST /api/creatives/reports/top-hooks/open`, sent by `RecordOpening` once per opened report, never while the status is `unavailable` (`creatives-report.tsx · L60–L76`).

More: [Reports](./05-reports.md#3-the-open-report-and-the-address).

## Stop 5 · The first request for creatives

**On screen.** Skeleton cards, then eight creatives. The controls above are real from the start.

**In the code.** `ReportBody` asks (`components/creatives/report-body.tsx · L66–L207`). `reportRequestParams` turns the state into query parameters (`report-state.ts · L398–L414`), and TanStack Query sends them:

```tsx title="components/creatives/report-body.tsx · L87–L103"
  // Galería asks for its page of cards. Totales and Diario ask for their own table pages
  // (`components/creatives/charts/`); the body reads their first page under the same cache key,
  // so it learns the total and the remainder without a request of its own.
  const chartView = state.view !== 'gallery';
  const orgId = scope?.orgId ?? '';
  const params = chartView
    ? tableRowsParams(state, currency, 0, '')
    : reportRequestParams(state, currency);
  const query = useQuery({
    queryKey: chartView
      ? ['creatives', 'charts', 'rows', orgId, params.toString()]
      : creativeReportKey(orgId, params),
    queryFn: ({ signal }) => fetchCreativeReport(params, signal),
    enabled: hasMetaAccount,
    staleTime: STALE_MS,
    retry: 1,
  });
```

The key holds the organization and the parameter string, so going back to a page or an order costs nothing (`components/creatives/report-data.ts · L38–L40`). Without a Meta account the query never runs: "Conecta tu cuenta de Meta" (`report-body.tsx · L118–L131`). A failure shows "Reintentar" (`L132–L145`).

**In the Network tab.** `GET /api/creatives/report` with `start`, `end`, `currency`, `sort=scroll_stopper_rate`, `dir=desc`, `limit=8`, `offset=0`, then the filters in the menu's fixed order: `format=video`. In the response (`lib/server-functions/creatives/get-creative-report.schema.ts · L424–L451`), `rows` is the page and `total` counts every page. `unassigned` is the remainder, spend with no key in the grouping. `coverage` is the share of Meta spend mapped to a creative. `break_even_roas` comes only to a full reader. Low coverage adds a note above the card, a remainder a line under it (`report-body.tsx · L180–L184`, `L192–L196`).

The full path is in [Where the data comes from, in one picture](#where-the-data-comes-from-in-one-picture).

## Stop 6 · The header

**On screen.** "Creativos /", the report's name with a chevron, the Meta logo, "Guardar", "Nuevo reporte" and "···". After a change of order or filters, "Modificado" and "Restablecer" appear.

**In the code.** `ReportHeader` (`components/creatives/report-header.tsx · L241–L277`) starts with `useOpenReport`: which report is open, of which kind, and whether the page still equals it (`components/creatives/reports/open-report.ts · L59–L103`). The name is `ReportSwitcher` (`components/creatives/reports/report-switcher.tsx · L48–L135`). Choosing a report pushes its plain address with `history.pushState`, so Next asks the server for no page (`report-switcher.tsx · L107–L110`, `open-report.ts · L97`).

"Modificado" compares the state and the definition as configurations, so page and page size never count (`open-report.ts · L91–L95`, `components/creatives/reports/report-modified.ts · L16–L53`). "Restablecer" pushes the plain address again (`open-report.ts · L98–L100`).

The platform select has one option (`report-header.tsx · L55–L76`). There is no currency control here. The currency is the user's stored preference, read by the server page and followed live in the browser (`report/page.tsx · L49`, `components/creatives/metric-options.ts · L125–L129`). Another page sets it, such as the Dashboard (`components/dashboard/dashboard-toolbar.tsx · L71`).

**In the Network tab.** Another report: a `report` request with its parameters. "Restablecer": usually nothing, the answer is cached.

## Stop 7 · The toolbar: dates, filters and grouping

**On screen.** Chips, "Filtro", "Agrupar: Creativo" and the date range. Pick "Últimos 7 días", tick a campaign under "Filtro", group by "Copy".

**In the code.** `ReportToolbar` (`components/creatives/report-toolbar.tsx · L26–L74`). Every control calls `update`, which merges a partial change with `applyReportPatch` and pushes the address (`report-state.ts · L573–L576`, `L428–L444`). Anything but metrics, view and page goes back to page 1 (`L417–L425`).

_Dates._ The selector builds its own query string, so the toolbar hands it `navigate` (`report-toolbar.tsx · L64–L71`):

```ts title="components/creatives/report-state.ts · L578–L585"
  const navigate = useCallback(
    (href: string) => {
      const query = href.includes('?') ? href.slice(href.indexOf('?') + 1) : href;
      const target = parseReportState(new URLSearchParams(query), defaults);
      update({ start: target.start, end: target.end });
    },
    [defaults, update]
  );
```

If the new dates are exactly a preset's today, the state keeps the preset (`report-state.ts · L436–L439`).

_Filtro._ `FilterMenu` lists the kinds and swaps the list for an editor in the same panel (`components/creatives/filter-menu.tsx · L65–L117`). A list applies on each tick (`components/creatives/filter-editors.tsx · L106–L129`). Campaña and Conjunto need names, so their editor asks for the range's options:

```ts title="components/creatives/report-data.ts · L69–L78"
export function useCreativeFilterOptions(start: string, end: string, enabled: boolean) {
  const scope = useCacheScope();
  return useQuery({
    queryKey: ['creatives', 'options', scope?.orgId ?? '', start, end] as const,
    queryFn: ({ signal }) => fetchCreativeFilterOptions(start, end, signal),
    enabled,
    staleTime: OPTIONS_STALE_MS,
    retry: 1,
  });
}
```

The chips follow the order filters were applied in, which is the order of their parameters in the address (`components/creatives/filter-chips.tsx · L180–L212`, `report-state.ts · L203–L214`).

_Agrupar._ `GroupMenu` lists the nine groupings (`components/creatives/group-menu.tsx · L57–L75`).

**In the Network tab.**

- A new range: a `report` request with `offset=0`. Outside the filter, `POST /api/user/preferences`: the selector saves the range as a preference (`date-range-selector.tsx · L496`, `components/providers/preferences-provider.tsx · L107`).
- Opening Campaña or Conjunto: `GET /api/creatives/options?start=…&end=…`, kept ten minutes (`report-data.ts · L63`). It also leaves when exactly one campaign or ad set is ticked, for the chip's name (`filter-chips.tsx · L58–L59`).
- A ticked campaign: `campaign=<id>` on a new `report` request. Copy: `group=copy`.

More: [The report page](./04-the-report-page.md#4-filters-and-grouping).

## Stop 8 · The controls of the content card

**On screen.** Inside the bordered card: the metric chips and "Métrica" with a plus sign on the left, "Orden:" and three view icons on the right. Move a chip, change the order, switch views.

**In the code.** `ReportControls` holds the three, and each calls `update` (`components/creatives/report-controls.tsx · L35–L58`).

- The chips and the picker change `metrics` (`components/creatives/metric-chips.tsx · L164–L187`, `components/creatives/metric-picker.tsx · L183–L225`). The metrics are not a request parameter: the route returns every metric of a row (`report-state.ts · L398–L407`).
- The order changes `sort` and `dir`, offering the chosen metrics plus Ventas (`components/creatives/sort-menu.tsx · L37–L39`). The server sorts every row before cutting the page.
- The switch changes `view` (`components/creatives/view-switch.tsx · L23–L40`). `ReportView` mounts Galería, Totales or Diario, the last two both `ChartReportView` (`components/creatives/report-view.tsx · L30–L39`, `components/creatives/totals-view.tsx · L11–L13`, `components/creatives/daily-view.tsx · L11–L13`). Each draws the front of the metric list: 4, 2 or 1 (`report-controls.tsx · L23–L27`).

**In the Network tab.** A metric change: nothing, the cards redraw, except in Diario (stop 12). A new order: a `report` request with the new `sort` or `dir`. The first switch to a chart view: one request with `limit=10` (stop 11).

More: [The report page](./04-the-report-page.md#5-metrics).

## Stop 9 · A card of Galería

**On screen.** The picture with a format badge, the name, one line per chosen metric, the verdict and "N ventas". Some cards show an icon and "Sin vista previa". Under the grid, the pagination with "Por página".

**In the code.** `GalleryView` draws the grid and the pagination (`components/creatives/gallery-view.tsx · L39–L101`). Every part of `CreativeCard` reads one field of the row (`components/creatives/creative-card.tsx · L177–L276`):

| Part of the card | Field of the row | Lines in `creative-card.tsx` |
| --- | --- | --- |
| Picture | `thumbnail_url` | `L217–L222` |
| Placeholder, when `thumbnail_url` is null | the format | `L129–L138` |
| Format badge | `display_format`, else `format` | `L184`, `L226–L233` |
| Name | `name` by creative, `label` when grouped | `L87–L113`, `L182` |
| Metric lines | `metrics[id]` per chosen id, "–" when absent | `L247–L265` |
| Verdict | `verdict`, "–" when null or absent | `L140–L162`, `L268` |
| "N ventas", or "N creativos" when grouped | `metrics.meta_orders`, or `creatives` | `L206`, `L270` |

The server fills those fields in `toRow`, from the creative that spent the most in the row (`lib/server-functions/creatives/build-creative-rows.ts · L142–L178`). The pagination calls `update` (`gallery-view.tsx · L95–L96`). While a page loads, the cards are skeletons and the pagination keeps the last total (`gallery-view.tsx · L68–L73`, `report-body.tsx · L105–L107`).

**In the Network tab.** Page 2: `offset=8`. Back to page 1: nothing, it is cached. 12 per page: `limit=12&offset=0`.

More: [The report page](./04-the-report-page.md#3-the-gallery-and-its-cards).

## Stop 10 · Hovering a video card

**On screen.** Rest the pointer on a video card. After a short pause the picture becomes the video, muted and looping. Move away and it stops.

**In the code.** The card starts a 300 ms timer, for a video only and never on touch (`creative-card.tsx · L52`, `L196–L204`). Then it mounts `CardVideo` with the row's `top_ad_id`, because the preview route answers per ad (`L223–L225`).

```tsx title="components/creatives/card-video.tsx · L79–L94"
  useEffect(() => {
    let live = true;
    loadJourneyPreview({ platform: 'meta', id: adId }, { force: attempt > 0 }).then(
      (answer) => {
        if (!live) return;
        if (answer.kind === 'video') setPreview(answer);
        else onUnavailable();
      },
      () => live && onUnavailable()
    );
    return () => {
      live = false;
    };
    // `onUnavailable` is the card's setter; a new one must not ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adId, attempt]);
```

`loadJourneyPreview` is the Customer Journey's client cache: it reuses a valid preview and shares a request in flight (`lib/customer-journey/ad-preview-client.ts · L96–L112`). The video starts muted because a hover is not a gesture (`card-video.tsx · L46–L52`).

**In the Network tab.** Filter by `ad-preview`: `GET /api/pixel/ad-preview?platform=meta&id=<ad id>`, on the first rest only (`ad-preview-client.ts · L80–L82`). The route also lets the Limited role in (`app/api/pixel/ad-preview/route.ts · L48–L61`).

## Stop 11 · Totales

**On screen.** Switch to Totales. Bars for ten creatives, and below the card a table of ticked rows. Untick one, tick one on page 2, click a column header, search.

**In the code.** `ChartReportView` (`components/creatives/charts/chart-report-view.tsx · L107–L218`) asks for two pages of 10, both from `reportRequestParams` (`components/creatives/charts/chart-data.ts · L54–L66`):

```tsx title="components/creatives/charts/chart-report-view.tsx · L127–L135"
  const rowsQuery = useChartTableRows(tableRowsParams(state, currency, page, query));
  // The scope's first page without search: the default selection and the empty state. The same
  // request as the table's while it shows page 1 unsearched, so it costs nothing extra then.
  const firstPage = useChartTableRows(tableRowsParams(state, currency, 0, ''));
  const { selection, ready, toggle } = useChartSelection(
    scopeKey,
    firstPage.data?.rows,
    CHART_DEFAULT_SERIES[kind]
  );
```

`useChartSelection` keeps the ticks in memory, at most 10, each with a colour slot, and starts over when the scope changes: the request without order, page and search (`components/creatives/charts/chart-selection.ts · L146–L172`, `chart-data.ts · L45–L51`). An eleventh tick shows "Puedes comparar hasta 10 creativos a la vez." (`components/creatives/charts/chart-table.tsx · L221–L226`, `L350`). A header click changes the report's own order (`L332–L339`).

The table sits under the card through an outlet, an empty element the body renders there (`report-body.tsx · L199–L204`). The view portals its table into it, so the DOM moves and the state stays (`components/creatives/charts/chart-table-slot.tsx · L23–L28`).

:::warning[The body reads the charts' cache entry instead of asking]

In Totales and Diario, `ReportBody` reads the charts' first page under the charts' key, `['creatives', 'charts', 'rows', …]` (`report-body.tsx · L87–L103`, `chart-data.ts · L89–L98`). That gives it the total and the remainder for free. Change one key and not the other, and every chart view costs an extra request.

:::

:::warning[The table search and "Nombre contiene" share one parameter]

The route has one `name`. While the table search has text, it replaces the filter's value (`chart-data.ts · L63–L64`): the rows ignore the filter while its chip still shows. The scope drops `name` too (`L33`, `L48`), so applying "Nombre contiene" in a chart view does not reset the ticks.

:::

**In the Network tab.** The switch: `limit=10&offset=0`. Table page 2: `offset=10`. A search: `name=<text>`, 300 ms after typing stops (`chart-report-view.tsx · L46–L47`). A header click: a new `sort` or `dir`. Ticks: nothing.

More: [The report page](./04-the-report-page.md#6-totales-and-diario).

## Stop 12 · Diario

**On screen.** Switch to Diario. Five lines, one per ticked row, for the first metric, day by day. Tick a sixth row.

**In the code.** The table is Totales', with 5 default ticks (`chart-selection.ts · L33`). The chart asks for its own data in `DailyChartArea` (`chart-report-view.tsx · L69–L105`):

```ts title="components/creatives/charts/chart-data.ts · L69–L80"
export function dailyParams(
  state: CreativeReportState,
  currency: string,
  metric: string,
  keys: readonly string[]
): URLSearchParams {
  const params = reportRequestParams(state, currency);
  for (const name of ['sort', 'dir', 'limit', 'offset']) params.delete(name);
  params.set('metric', metric);
  for (const key of keys) params.append('key', key);
  return params;
}
```

The chart draws only the keys still ticked, so an untick is instant (`components/creatives/charts/daily-line-chart.tsx · L49–L60`). The server runs the report's read to learn which ads make up each key, then reads those ads day by day (`lib/server-functions/creatives/get-creative-daily.ts · L31–L73`).

**In the Network tab.** `GET /api/creatives/daily` with the report's scope, `metric` and five `key`. Each tick, untick or new first metric sends another. It is the page's slowest request, 3 to 9 seconds on a large store (`chart-report-view.tsx · L15–L16`).

More: [The report data](./03-the-report-data.md#7-filters-the-daily-series-and-the-filter-options).

## Stop 13 · Saving a report

_Needs migration 036. Before it, "Guardar" is disabled and says why._

**On screen.** On "Top Hooks", change the order, press "Guardar" and name it in "Guardar como reporte nuevo". The address changes to a new id. In the gallery, star a card.

**In the code.** What "Guardar" does depends on the open report:

```tsx title="components/creatives/report-header.tsx · L84–L106"
function saveModeOf(report: OpenReport, saved: SavedReportsApi): SaveMode {
  if (!saved.available) return 'unavailable';
  if (report.kind !== 'saved') return 'new';
  if (report.item?.hiddenParts) return 'hidden';
  return report.modified ? 'over' : 'clean';
}

/** The report actions of the header and of the "···" menu. */
function useReportActions(report: OpenReport) {
  const t = useTranslations('creatives.saved');
  const saved = useSavedReports();
  const { state } = useCreativeReportState();
  const router = useRouter();
  const mode = saveModeOf(report, saved);

  const saveAsNew = () =>
    saved.saveAsNew(reportConfigFromState(state), { onCreated: (id) => report.open(id) });

  const save = () => {
    if (mode === 'new') saveAsNew();
    else if (mode === 'over' && report.id)
      void saved.saveOver(report.id, reportConfigFromState(state));
  };
```

`reportConfigFromState` turns the state into a configuration, a preset range kept as the preset (`report-state.ts · L488–L499`). The provider opens the name dialog (`components/creatives/reports/report-dialogs.tsx · L73–L159`). On submit it posts, writes the report into the cached list, and `onCreated` opens the new id, which `definition` already knows (`saved-reports-provider.tsx · L253–L261`, `saved-reports.ts · L132–L144`). The star is optimistic: the cache first, then the request, rolled back with a message on a refusal (`saved-reports-provider.tsx · L200–L211`).

**In the Network tab.**

- `POST /api/creatives/reports`, body `{ name, config }`: 201 with `{ report }`, or 409 `name_taken`, shown under the field (`report-dialogs.tsx · L105–L108`, `app/api/creatives/reports/route.ts · L42–L61`).
- Then `POST /api/creatives/reports/<new id>/open`. Usually no `report` request: the saved configuration asks for the same rows.
- Over a saved report: `PATCH /api/creatives/reports/<id>` with `{ config }`. Renaming: the same with `{ name }`. Deleting: `DELETE`. The star: `PUT` or `DELETE` on `…/<id>/favorite`.

More: [Reports](./05-reports.md#4-saved-reports-in-postgres).

## Stop 14 · What a Limited member sees

**On screen.** As a Limited member: eight report cards, "–" where the verdict goes, no estimated profit in the picker, no "Veredicto" in "Filtro", no verdict column in the table.

**In the code.** Each server page reads the role from the Limited permission (`app/(app)/(analytics)/creatives/page.tsx · L24`, `report/page.tsx · L31`). A member with both permissions counts as Limited (`app/api/creatives/authorize.ts · L23`). Three places decide what the role gets.

1. **The gallery's list.** `readyMadeReports` drops a report that sorts by a hidden metric or filters by verdict (`ready-made-reports.ts · L63–L79`). An address naming one finds no `definition` and opens the plain page (`L81–L87`).
2. **The route's refusal.** A hidden sort or a verdict filter is a 400 before any data is read (`app/api/creatives/report/route.ts · L28–L37`). The daily route checks its `metric` the same way (`app/api/creatives/daily/route.ts · L29–L35`).
3. **The server never computing the numbers.** The margin is never fetched (`get-creative-report.ts · L432`), so the builder has nothing to compute with:

```ts title="lib/server-functions/creatives/build-creative-rows.ts · L185–L191"
  if (!allowedSortMetrics(role).includes(sort)) throw new CreativeSortNotAllowedError(sort);
  if (role.isLimited && filters.verdict.length > 0) {
    throw new CreativeFilterNotAllowedError('verdict');
  }

  const estimated = role.isLimited ? null : PIXEL_EST_METRICS.meta(role.margin);
  const breakEven = role.isLimited ? null : breakEvenRoas(role.margin);
```

Rows get no `verdict` and the answer no `break_even_roas` (`build-creative-rows.ts · L238`, `L261`). The page adds guards on top: the offered metrics, the filter menu, the address parser and the table's columns (`metric-options.ts · L46–L51`, `filter-menu.tsx · L77`, `report-state.ts · L175`, `chart-table.tsx · L285–L294`).

**In the Network tab.** The same requests as a full reader, with less in each answer. A 400 means the page sent something the role may not ask for: a bug on the page side.

More: [The report data](./03-the-report-data.md#6-the-limited-role).

## Where the data comes from, in one picture

One `GET /api/creatives/report`, from the grid to ClickHouse and back.

1. **`ReportBody`** · builds the parameters with `reportRequestParams` and asks TanStack Query under `creativeReportKey` (`report-state.ts · L398–L414`, `report-body.tsx · L92–L103`, `report-data.ts · L38–L40`).
2. **`fetchCreativeReport`** · sends the request (`report-data.ts · L42–L49`).
3. **The route** · `authorizeCreativesRequest`: 401 without an organization, 403 without either reports permission, else the organization and `isLimited` (`app/api/creatives/report/route.ts · L24–L26`, `app/api/creatives/authorize.ts · L12–L24`).
4. **The route** · reads repeated parameters as lists, validates, refuses the Limited role's hidden asks, applies the plan block (`route.ts · L28–L40`, `get-creative-report.schema.ts · L248–L263`).
5. **The route** · labels the ClickHouse queries with `withQueryContext` and calls `getCreativeReport` (`route.ts · L42–L57`, `get-creative-report.ts · L445–L465`).
6. **`loadCreativeScope`** · finds the Meta accounts, or returns an empty report (`get-creative-report.ts · L401–L413`).
7. **Three reads in parallel** (`L415–L433`). The metrics query, one line per creative and ad, from `creative_daily`, `ad_performance` and `ad_objects`, plus `creative_ad_map` for copy, headline and landing (`L172–L256`). The attributes query, one line per creative, from `creative_attributes` (`L284–L326`). The store margin, skipped for the Limited role (`L432`).
8. **`buildCreativeRows`** · in TypeScript: coverage, per-ad filters, grouping, metrics and verdicts, spend and verdict filters, sort, page cut (`build-creative-rows.ts · L180–L263`).
9. **`nameRows`** · for copy, headline, campaign and ad set, names the page's rows (`get-creative-report.ts · L332–L351`, `L463`).
10. **The route** · answers the JSON, or logs and answers 500 (`route.ts · L57–L61`).
11. **`GalleryView`** · draws one `CreativeCard` per row (`report-view.tsx · L30–L39`, `gallery-view.tsx · L74–L83`).

The daily and options routes share steps 3 to 5 (`app/api/creatives/daily/route.ts · L21–L59`, `app/api/creatives/options/route.ts · L16–L35`). The why is in [The report data](./03-the-report-data.md).

## If you want to change something

| I want to… | Start in |
| --- | --- |
| Change the layout of a creative card | `components/creatives/creative-card.tsx · L177–L276` |
| Change how many cards a page holds | `components/creatives/report-state.ts · L69` (`CREATIVE_PAGE_SIZES`), `L80` (the default) |
| Change the values a filter offers | `lib/server-functions/creatives/get-creative-report.schema.ts · L102–L107` (what the route accepts), `components/creatives/filter-editors.tsx · L67–L71` (what the editor lists), labels under `creatives.filters.values` |
| Add a filter kind | `components/creatives/report-filters.ts · L13–L43`, then the list in [The report page](./04-the-report-page.md#4-filters-and-grouping). Server: `get-creative-report.schema.ts · L133–L148`, `lib/server-functions/creatives/creative-row-scope.ts · L139–L164` |
| Add a grouping | `get-creative-report.schema.ts · L88–L98`, `creative-row-scope.ts · L172–L199`, the card title in `creative-card.tsx · L87–L113`, texts under `creatives.group` |
| Change the default metrics | `components/creatives/metric-options.ts · L32` |
| Change a ready-made report | `lib/server-functions/creatives/report-config.schema.ts · L224–L294`. Icon and colour: `components/creatives/reports/ready-made-reports.ts · L41–L54`. Keep the id: favourites and recents point at it (`report-config.schema.ts · L216–L223`) |
| Change a text | `messages/es.json · L3254–L3621`, every key under `creatives.`. The same block starts at `messages/en.json · L3521` and `messages/pt.json · L3254` |
| Change the verdict band | `get-creative-report.schema.ts · L114` (`CREATIVE_VERDICT_BAND`) |
| Change the colours of chart series | `components/creatives/charts/chart-selection.ts · L103–L140` (a row's colour by slot). A metric's colour by position: `chartSeriesBgClass(slot + 1)`, `creative-card.tsx · L256` |
| Change an empty or error state | `components/creatives/report-body.tsx · L117–L176`, `components/creatives/gallery-view.tsx · L50–L56`, `components/creatives/charts/chart-report-view.tsx · L141–L169`, `components/creatives/reports/report-gallery.tsx · L80–L96`. All drawn by `ReportMessage`, `components/creatives/view-coming-soon.tsx · L11–L33` |
| Change the hover delay or the low-coverage threshold | `creative-card.tsx · L52` (`HOVER_REST_MS`), `report-body.tsx · L51` (`LOW_COVERAGE`) |

## Terms

- **snapshot**: what the server page knows of the saved reports: ready, unavailable or error.
- **definition**: the function that turns a report id into its configuration.
- **marker**: `sort` next to `report`, the sign that the page wrote the address.
- **scope**: the chart views' request without order, page and search. A new one resets the ticks.
- **slot**: a position in the metric list or among the ticks. It gives the colour.
- **outlet**: the empty element under the content card that receives the charts' table.
- **top ad**: the ad that spent the most with a creative. Its id asks for the video.
- **remainder**: spend with no key in the grouping, answered as `unassigned`.
- **Limited role**: the media buyer role, `org:reports:read_limited`: no estimated profit, verdict or break-even.
