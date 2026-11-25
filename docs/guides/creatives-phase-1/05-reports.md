---
title: "Reports"
sidebar_label: "5. Reports"
sidebar_position: 5
description: "What a Creativos report is, where the ready-made ones live, what an address that names a report shows, and how saved reports, favourites and recents are stored, shared and limited by role."
---

# Reports

*After this chapter you can say what a report is, where the twelve ready-made ones live, and what an address that names a report shows on first open and after a change. You can also predict what a save stores, who sees and changes it, what a Limited member gets, and what the page does before the database is ready.*

<small>~11 min · Built on: ESC-799, docs/features/creatives/README.md</small>

:::tip[In simple terms]

A report is the position of every control of the report page: the date range, the filters, the grouping, the order, the chosen metrics and the view, never the data.

Escalafy ships twelve ready-made reports in the app's code; nobody can change them. The limited media buyer role does not see the four built around a number it may not see.

An address can name a report. Until the user touches a control, the page shows that report as defined, its range counted from today. After the first change, the address carries every control, so a copied link shows the same page. The header says "Modificado" while the page differs from the report.

A member can save the page under a name. The saved report belongs to the organization: every member sees it and can rename, overwrite or delete it. Stars and recently opened reports are personal. The database itself refuses a duplicate name, a 201st report and a star on another organization's report.

A limited member cannot save hidden numbers, receives saved reports without them, and cannot save over a report that has them. A preset range, such as the last 14 days, stays relative when saved. Until the tables exist, only the ready-made reports work and saving is disabled with a reason.

:::

## 1. A report is a configuration

A report holds the page's controls: the platform (only Meta in phase 1), the dates, the filters, the grouping, the sort and its direction, one to twenty ordered metrics, and the view. Ready-made and saved reports share it. The dates are a preset, resolved on the day of opening, or two fixed days.

In the code, the shape is `reportConfigSchema`, in the client-safe `lib/server-functions/creatives/report-config.schema.ts`. Its dates are `reportDateSchema` (`L36–L40`), turned into days by `resolveReportRange` (`L94–L100`).

```ts title="lib/server-functions/creatives/report-config.schema.ts · L68–L77"
export const reportConfigSchema = z.object({
  platform: z.enum(CREATIVE_REPORT_PLATFORMS),
  date: reportDateSchema,
  filters: reportFiltersSchema,
  group: z.enum(CREATIVE_GROUPINGS),
  sort: metricId,
  dir: z.enum(['asc', 'desc']),
  metrics: z.array(metricId).min(1).max(CREATIVE_REPORT_MAX_METRICS),
  view: z.enum(CREATIVE_REPORT_VIEWS),
});
```

Two functions in `components/creatives/report-state.ts` convert it to and from the page state, described in [The report page](./04-the-report-page.md). `stateFromReportConfig` resolves the range on today, keeps the metrics the session is offered, replaces a sort it may not use, drops the verdict filter for the Limited role and starts on the first page (`L452–L482`). `reportConfigFromState` goes back, writing `{ preset }` when the state's `datePreset` is set and `{ start, end }` otherwise (`L488–L499`).

The date selector never says which preset was chosen: it sets `start` and `end` and deletes `preset` (`components/ds/date-range-selector.tsx · L488–L503`). So after a range change, `applyReportPatch` asks `presetOfRange` which preset, in panel order, gives exactly those dates today (`report-state.ts · L436–L439`, `L228–L247`). The selector highlights a preset by the same rule (`date-range-selector.tsx · L270–L278`).

:::info[Why this way]

Storing the route's query string was the alternative: it holds resolved dates, so no report could stay relative. Making the selector report its preset was left out of this change; matching by dates reuses its own rule.

:::

:::warning[Gotcha]

A hand-picked range that equals a preset is saved as that preset. Pick by hand exactly the days "Últimos 14 días" covers today, and the page cannot tell the two apart (`report-state.ts · L436–L439`): it stores `{ preset: 'last14' }`, and next week shows that week's 14 days.

:::

## 2. Ready-made reports live in code

The twelve ready-made reports are definitions in code, each with a fixed id such as `top-hooks`. By default a report covers the last 14 days, groups by creative, sorts descending and shows the gallery.

In the code, `CREATIVE_READY_MADE_REPORTS` is a read-only array (`report-config.schema.ts · L227–L294`) built by `report`, which fills those defaults (`L200–L214`). The ids must stay fixed: favourites and recents point at them (`L216–L223`). "Top para escalar" (active, profitable, by ROAS) and "Top para apagar" (active, unprofitable, by spend) ship without their spend threshold, which is not defined yet (`L260–L273`). A change or delete of a ready-made id answers 403 `read_only_report`, and reading one 404 (`app/api/creatives/reports/[id]/route.ts · L26–L27`, `L37`, `L57`, `L92`).

`components/creatives/reports/ready-made-reports.ts` adds an icon and a palette colour per id (`L40–L54`). Names and descriptions are message keys, `creatives.reports.names.<id>` and `creatives.reports.descriptions.<id>` (`components/creatives/reports/report-list.ts · L66–L81`). `ready-made-reports.ts` also decides what the Limited role sees:

```ts title="components/creatives/reports/ready-made-reports.ts · L63–L70"
/**
 * A report keeps its meaning for the role: it does not sort by a metric the role is not offered,
 * and a Limited session gets no verdict filter.
 */
export function isReportAvailable(config: CreativeReportConfig, isLimited: boolean): boolean {
  if (!creativeMetricIds(isLimited).includes(config.sort)) return false;
  return !(isLimited && config.filters.verdict.length > 0);
}
```

A Limited member sees eight (`ready-made-reports.ts · L72–L79`): "Top Ganancia" and "Top de la semana" sort by estimated profit, "Top para escalar" and "Top para apagar" filter by verdict. Reports that only list estimated profit lose it on load (`report-state.ts · L459–L462`). An address naming a hidden report opens the plain page, because `readyMadeDefinition` does not know the id (`ready-made-reports.ts · L81–L87`).

:::info[Why this way]

Hiding beat stripping: "Top Ganancia" without its sort would be "Top Inversión" under the wrong name. Code beat a table seeded by a migration: each definition is typed and ships with the page that reads it.

:::

## 3. The open report and the address

`/creatives/report?report=top-hooks` names the open report and means "as defined", the range resolved on the day it opens. After a change, the page writes its whole state next to the report, so a copied link shows that page. The switcher and "Restablecer" push the plain address again.

In the code, the parameter is `CREATIVE_REPORT_PARAM` (`report-state.ts · L129`). The page's defaults carry `definition`, which turns an id into a configuration: ready-made first, then the saved reports in the browser's cache (`components/creatives/creatives-report.tsx · L91–L101`). `stateFromAddress` picks the reading:

```ts title="components/creatives/report-state.ts · L509–L519"
export function stateFromAddress(
  params: URLSearchParams,
  defaults: CreativeReportDefaults,
  today: string
): CreativeReportState {
  const id = params.get(CREATIVE_REPORT_PARAM);
  const config = id && !params.has('sort') ? defaults.definition?.(id) : undefined;
  return config
    ? stateFromReportConfig(config, { defaults, today })
    : parseReportState(params, defaults, today);
}
```

The marker, the sign that the page wrote an address, is `sort`: `serializeReportState` drops values equal to their default, but next to `report` always writes `sort` (`L373–L376`). `open` and `reset` push `reportHref` alone, which replaces the whole state (`components/creatives/reports/open-report.ts · L97–L100`, `report-list.ts · L56–L59`).

"Modificado" compares the page with the definition loaded the way the page loads it (`open-report.ts · L91–L95`). `isReportModified` fingerprints both sides through `reportConfigFromState` (`components/creatives/reports/report-modified.ts · L16–L53`), so the page, the page size and the order the filters were applied in never count. Filter values compare in any order; metric order counts (`L31–L38`). Dates compare the preset and the days (`L27`). The new report and the page without a report are never modified (`open-report.ts · L92`). The header shows "Modificado" and "Restablecer" while it is true (`components/creatives/report-header.tsx · L251–L271`).

:::info[Why this way]

Writing the definition into the address in an effect was the alternative: one render would ask for the default report, and an untouched link would freeze its range. Deriving it during render makes the first request carry the report.

:::

:::warning[Gotcha]

Why `sort` and not `start`: on mount, the date selector writes the range into an address that has none (`report-state.ts · L501–L507` says so too):

```ts title="components/ds/date-range-selector.tsx · L505–L516"
  useEffect(() => {
    const missingRange = !searchParams.get('start') || !searchParams.get('end');
    const blockedByPreset = showPresets && searchParams.get('preset');
    if (missingRange && !blockedByPreset && date?.from && date?.to) {
      const bounded = applyBounds(date);
      if (!bounded?.from || !bounded?.to) return;
      const params = new URLSearchParams(searchParams);
      params.set('start', formatDateForUrl(bounded.from));
      params.set('end', formatDateForUrl(bounded.to));
      params.delete('preset');
      window.history.replaceState(null, '', `?${params.toString()}`);
    }
```

The first version read "no `start`" as "as defined", so right after the first render the report fell back to the page's defaults. A marker must be a parameter no other component writes.

:::

## 4. Saved reports in Postgres

A saved report is a name plus a configuration, owned by the organization. A favourite and a recent belong to one person and point at a ready-made id or a saved report, never both.

In the code, migration `docs/migrations/036_creative_saved_reports.sql` creates three tables. `creative_saved_report` holds `organization_id`, `name`, `config` as `jsonb`, and Clerk user ids in `created_by` and `updated_by` (`L33–L47`). The name is trimmed, 1 to 80 characters (`L45–L46`), and unique per organization ignoring case (`L49–L51`). The recents table repeats the favourites' shape (`L69–L82`):

```sql title="docs/migrations/036_creative_saved_reports.sql · L53–L67"
CREATE TABLE IF NOT EXISTS public.creative_report_favorite (
  organization_id text        NOT NULL,
  user_id         text        NOT NULL,
  ready_made_id   text,
  saved_report_id uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT creative_report_favorite_one_ref
    CHECK (num_nonnulls(ready_made_id, saved_report_id) = 1),
  CONSTRAINT creative_report_favorite_saved_fkey
    FOREIGN KEY (organization_id, saved_report_id)
    REFERENCES public.creative_saved_report (organization_id, id) ON DELETE CASCADE,
  -- NULLs never collide, so each key only constrains rows of its own kind.
  CONSTRAINT creative_report_favorite_ready_made_key UNIQUE (organization_id, user_id, ready_made_id),
  CONSTRAINT creative_report_favorite_saved_key UNIQUE (organization_id, user_id, saved_report_id)
);
```

The foreign key targets the pair of organization and report (`036_creative_saved_reports.sql · L43–L44`). A star stores the caller's organization (`lib/server-functions/creatives/star-creative-report.ts · L21–L24`), so a star on another organization's report has no target. Deleting a report removes every member's stars and recents of it.

The cap of 200 is inside the insert, and no row back means the limit (`lib/server-functions/creatives/create-creative-saved-report.ts · L35–L45`). `savedReportDbError` maps a missing table, a taken name and an outside reference to domain errors (`lib/server-functions/creatives/saved-report-sql.ts · L34–L50`). `recordCreativeReportOpen` moves a report to now and keeps the newest 8, in one statement (`lib/server-functions/creatives/record-creative-report-open.ts · L27–L57`).

:::info[Why this way]

A check in each route was the alternative to the composite key; one forgotten check would store a cross-organization star. The unique index settles a taken name even for two saves at once. Who may change a saved report is a build default: see [Decisions and open questions](./06-decisions-and-open-questions.md).

:::

## 5. The routes and the page's actions

Eight endpoints serve saved reports: list, create, read one, rename or save over, delete, star, unstar, record an opening. Each needs an organization, a user and either report permission; no plan, since they store no numbers.

In the code, they live in `app/api/creatives/reports/route.ts` (`L25`, `L42`), `[id]/route.ts` (`L33`, `L52`, `L87`), `[id]/favorite/route.ts` (`L14`, `L31`) and `[id]/open/route.ts` (`L14`). `authorizeSavedReportsRequest` adds the user to the creatives permission step, and `savedReportErrorResponse` maps errors to 503 `saved_reports_unavailable`, 404 `not_found`, 409 `name_taken`, 409 `report_limit_reached` or 500 (`app/api/creatives/reports/respond.ts · L24–L30`, `L48–L64`). A path id that is neither a ready-made id nor a uuid is 404 before any query (`lib/server-functions/creatives/creative-saved-report.schema.ts · L62–L66`). A change carries a name or a configuration, never both (`L42–L46`).

Configurations are validated on the way in (`creative-saved-report.schema.ts · L35–L46`) and on the way out: `toCreativeSavedReport` answers one that no longer validates as `readable: false`, name only (`L181–L205`). `listCreativeSavedReports` maps every row through it, so one bad row never breaks the list (`lib/server-functions/creatives/list-creative-saved-reports.ts · L80–L85`). Its card says "Ya no se puede abrir", has no link and only deletes (`components/creatives/reports/report-card.tsx · L104–L111`, `L144–L163`); the switcher leaves it out (`components/creatives/reports/report-switcher.tsx · L54–L56`).

`components/creatives/reports/saved-reports.ts` keeps the list in one query entry per organization (`L109–L128`). `SavedReportsProvider` runs the actions and writes each result there (`components/creatives/reports/saved-reports-provider.tsx · L152–L159`). "Guardar" asks a name on a ready-made report, the new report or the plain page, and saves over a saved report with changes (`report-header.tsx · L82–L106`). A taken name shows under the field, other codes in a callout (`components/creatives/reports/report-dialogs.tsx · L97–L112`). The star is optimistic:

```tsx title="components/creatives/reports/saved-reports-provider.tsx · L200–L211"
  const toggleFavourite = useCallback(
    (item: CreativeReportListItem) => {
      const ref = { kind: refKind(item), id: item.id };
      const on = !item.favourite;
      edit((current) => withFavourite(current, ref, on));
      setReportFavourite(item.id, on).catch(() => {
        edit((current) => withFavourite(current, ref, !on));
        toast.error(t('errors.favourite'));
      });
    },
    [edit, t]
  );
```

`RecordOpening` records one opening, without waiting, each time the open report changes, never for the new report: paging or sorting records nothing (`creatives-report.tsx · L60–L76`, `saved-reports-provider.tsx · L213–L220`). The gallery shows 4 of the 8 recents (`components/creatives/reports/saved-report-items.ts · L38–L39`).

:::info[Why this way]

Asking for the list again after each action was the alternative. One written entry updates the gallery, the switcher and the page's definitions together, so a new report is known before the page opens it. A star is cheap to undo.

:::

## 6. The Limited role and saved reports

A configuration is revealing when it shows or sorts by a metric the Limited role may not see, or filters by verdict. Three rules keep that member from seeing those parts or erasing them.

In the code, `configHasHiddenParts` decides it (`creative-saved-report.schema.ts · L74–L80`). Creating a revealing configuration is 403 `hidden_for_role` (`app/api/creatives/reports/route.ts · L48–L50`). On read, `limitCreativeReportConfig` drops hidden metrics (spend alone if none is left), sorts by spend instead and empties the verdict filter, and `hidden_parts_removed` says so (`creative-saved-report.schema.ts · L87–L95`, `L196–L203`). Saving over checks what is sent and what is stored:

```ts title="app/api/creatives/reports/[id]/route.ts · L73–L79"
    const { config } = parsed.data;
    if (caller.isLimited) {
      if (configHasHiddenParts(config)) return savedReportError(403, 'hidden_for_role');
      const stored = await getCreativeSavedReport({ ...caller, id: ref.id });
      if (stored.hidden_parts_removed) return savedReportError(403, 'report_has_hidden_parts');
    }
    const report = await replaceCreativeSavedReportConfig({ ...caller, id: ref.id, config });
```

The page shows "Partes ocultas para tu rol" and disables "Guardar" with the reason (`report-header.tsx · L84–L89`, `L216–L234`). "Guardar como reporte nuevo" stays: it sends the page's state, loaded from the stripped configuration (`L99–L100`). Its data rules: [The report data](./03-the-report-data.md).

:::info[Why this way]

Accepting that save was the alternative: the page holds only the stripped configuration, so it would delete a full reader's profit metric or verdict filter for everyone. Stripping beat hiding here because a saved report is shared work.

:::

## 7. Before the migration runs

Until the migration runs on the shared database, the tables do not exist. Ready-made reports, being code, still work. The other gallery groups are absent and every saving action says "Los reportes guardados todavía no están disponibles."

In the code, Postgres answers 42P01, which `savedReportDbError` turns into `CreativeSavedReportsUnavailableError` (`saved-report-sql.ts · L39–L40`). The routes answer 503 `saved_reports_unavailable` with a warning in the log (`respond.ts · L52–L55`). Both server pages call `loadSavedReports`, which never throws: a missing table is `unavailable`, anything else `error` (`app/(app)/(analytics)/creatives/load-saved-reports.ts · L12–L33`, `app/(app)/(analytics)/creatives/page.tsx · L24–L26`, `app/(app)/(analytics)/creatives/report/page.tsx · L35–L39`). In the browser that snapshot seeds the query unless it is `error` (`saved-reports.ts · L119–L128`), and a fetch reads the 503 as a value:

```ts title="components/creatives/reports/saved-reports.ts · L80–L89"
/** `GET /api/creatives/reports` → the snapshot; 503 `saved_reports_unavailable` is not an error. */
export async function fetchSavedReports(signal?: AbortSignal): Promise<SavedReportsSnapshot> {
  const response = await fetch(ROUTE, { signal });
  const body = await readBody(response);
  if (response.status === 503 && errorCode(body) === UNAVAILABLE) return { status: 'unavailable' };
  if (!response.ok || !isList(body)) {
    throw new SavedReportRequestError(response.status, errorCode(body));
  }
  return { status: 'ready', list: body };
}
```

The provider turns it into `available: false` and no lists (`saved-reports-provider.tsx · L141–L149`, `L161–L164`, `L225`), and empty groups are left out (`components/creatives/reports/report-section.tsx · L28–L29`). "Nuevo reporte" (`components/creatives/reports/report-gallery.tsx · L52–L63`), the stars (`report-card.tsx · L67–L76`), "Guardar" and "Guardar como reporte nuevo" (`report-header.tsx · L85`, `L155–L159`) are disabled, and no opening is recorded (`creatives-report.tsx · L65`). The command is in [Trying it on staging](./07-trying-it-on-staging.md).

:::info[Why this way]

As an error, the 503 would be retried and shown as a failure while nothing is broken, and a server page that threw would hide a usable page.

:::

## Follow a request

A full reader opens "Top Hooks" from the gallery, sorts by ROAS, presses "Guardar" and names the report. The user's side is in [Using the page](./02-using-the-page.md).

1. **Browser** · The card links to `reportHref('top-hooks')`.
2. **Server page** · Reads the saved reports' snapshot with `loadSavedReports` and renders the page with it.
3. **Browser** · `stateFromAddress` finds `report` and no `sort`, so `stateFromReportConfig` loads the definition: videos only, by Thumbstop, the last 14 days. The date selector then writes `start` and `end`; the reading does not change.
4. **Browser** · `RecordOpening` sends `POST /api/creatives/reports/top-hooks/open` and moves the report to the front of the cached recents.
5. **Browser** · The user sorts by ROAS. `serializeReportState` writes the whole state with `sort=meta_roas` next to `report`. `isReportModified` turns true: "Modificado" and "Restablecer" show.
6. **Browser** · "Guardar": `saveModeOf` answers `new` for a ready-made report, and `saveAsNew` opens the name dialog with `reportConfigFromState`, dated `{ preset: 'last14' }`.
7. **Route** · `POST /api/creatives/reports` with `{ name, config }`: `authorizeSavedReportsRequest`, the body schema, the Limited check, `createCreativeSavedReport`. 201 with the report, or 409 `name_taken` under the field.
8. **Browser** · `submitName` adds the report to the cache with `withCreated`, shows a toast and opens the new id: `?report=<uuid>`.
9. **Browser** · `stateFromAddress` reads the saved configuration from the cache. The report is saved and unmodified, so "Guardar" says "No hay cambios para guardar.", and `RecordOpening` records its first opening.

## Where to look

| Role | File |
| --- | --- |
| Current behaviour of the feature | `docs/features/creatives/README.md` |
| Report configuration and the 12 ready-made reports (client-safe) | `lib/server-functions/creatives/report-config.schema.ts` |
| Page state, address, conversions, preset match | `components/creatives/report-state.ts` |
| The date selector's address writes | `components/ds/date-range-selector.tsx` |
| Ready-made look and the Limited rule | `components/creatives/reports/ready-made-reports.ts` |
| List items, groups, report address | `components/creatives/reports/report-list.ts` |
| The open report, its kind, "Restablecer" | `components/creatives/reports/open-report.ts` |
| "Modificado" | `components/creatives/reports/report-modified.ts` |
| Report definitions for the page, openings | `components/creatives/creatives-report.tsx` |
| Header actions, "Guardar" modes, hidden-parts note | `components/creatives/report-header.tsx` |
| The gallery of reports | `components/creatives/reports/report-gallery.tsx` |
| One group of the gallery | `components/creatives/reports/report-section.tsx` |
| Report card, star, card menu, unreadable card | `components/creatives/reports/report-card.tsx` |
| The switcher | `components/creatives/reports/report-switcher.tsx` |
| Fetches, cache entry, cache writes | `components/creatives/reports/saved-reports.ts` |
| Groups, colour and icon, new report id | `components/creatives/reports/saved-report-items.ts` |
| Actions, status, optimistic star | `components/creatives/reports/saved-reports-provider.tsx` |
| Name and delete dialogs, error messages | `components/creatives/reports/report-dialogs.tsx` |
| Server snapshot | `app/(app)/(analytics)/creatives/load-saved-reports.ts` |
| Gallery server page | `app/(app)/(analytics)/creatives/page.tsx` |
| Report server page | `app/(app)/(analytics)/creatives/report/page.tsx` |
| The three tables | `docs/migrations/036_creative_saved_reports.sql` |
| Limits, bodies, reference parser, Limited rule, types (client-safe) | `lib/server-functions/creatives/creative-saved-report.schema.ts` |
| Postgres error codes | `lib/server-functions/creatives/saved-report-sql.ts` |
| The list query | `lib/server-functions/creatives/list-creative-saved-reports.ts` |
| Create, with the cap | `lib/server-functions/creatives/create-creative-saved-report.ts` |
| Star a report | `lib/server-functions/creatives/star-creative-report.ts` |
| Record an opening, keep 8 | `lib/server-functions/creatives/record-creative-report-open.ts` |
| Shared auth step and error answers | `app/api/creatives/reports/respond.ts` |
| List and create routes | `app/api/creatives/reports/route.ts` |
| Read, rename or save over, delete routes | `app/api/creatives/reports/[id]/route.ts` |
| Star and unstar routes | `app/api/creatives/reports/[id]/favorite/route.ts` |
| Opening route | `app/api/creatives/reports/[id]/open/route.ts` |

## Terms

- **report configuration**: The position of every control of the report page: platform, dates, filters, grouping, sort, ordered metrics, view.
- **ready-made report**: One of the twelve configurations in code, with a fixed id; opened, starred and saved as new, never changed. (README: "reporte prearmado")
- **saved report**: A name plus a configuration a member saved; it belongs to the organization. (UI: "Tus reportes")
- **open report**: The report the address's `report` names, if the session may open it.
- **new report**: The unsaved report at `?report=nuevo`, "Reporte sin título", created on its first save.
- **marker**: `sort` next to `report`, the sign that the page wrote the address.
- **report reference**: What a favourite or a recent points at: a ready-made id or a saved report's id.
- **favourite**: A star one person put on a report in one organization. (UI: "Favoritos")
- **recent**: One of the last 8 reports one person opened in one organization; 4 are shown. (UI: "Recientes")
- **revealing configuration**: One that shows or sorts by a metric hidden from the Limited role, or filters by verdict.
- **relative range**: A saved date that is a preset, resolved again on the day the report is opened.
- **unreadable report**: A saved report whose stored configuration no longer validates; listed by name, only deletable.
- **snapshot**: What the server page knows of the saved reports: ready with the list, unavailable or error.
