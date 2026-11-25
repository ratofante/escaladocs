---
title: "Trying it on staging"
sidebar_label: "7. Trying it on staging"
sidebar_position: 7
description: "The order to check Creativos on the staging preview: what must work before the database migration, how to run and undo the migration, and what to check after it."
---

# Trying it on staging

_After this chapter you can deploy the branch to the staging preview, check the feature in two passes, run the one migration it needs and undo it if something looks wrong._

:::tip[In simple terms]

Nothing in this feature has been seen in a browser with real numbers. The automated checks pass, and they cannot tell whether a card looks right or whether a filter returns what a person expects. The staging preview is the first place where that can be judged.

The check has two passes, because the feature has two halves.

The first half reads numbers and shows them: the gallery of ready-made reports, the report page, filters, grouping, the charts. It needs nothing new in the database. It can be deployed and checked today.

The second half writes: saving a report, starring one, remembering the last ones opened. It needs three new tables. A file that creates them is in the branch. Nobody has run it.

So the order is: deploy, check the first half, run the file, check the second half. Between the two, the page must behave well on its own. The save buttons are switched off and say why, and nothing fails.

One thing to keep in mind throughout. The staging preview uses the production database. A report saved while testing is a real row, visible to the real members of that organization. Test in the demo organization and delete what you create.

:::

## 1. Before anything: where to test

Use an organization that has advertising data on Meta and a member with the full reports role. Keep the browser's DevTools open on the Network tab, filtered by `api/creatives`.

For the role checks you also need a member with the Limited role in the same organization.

Create and delete saved reports only in an organization meant for testing. Reading is harmless anywhere.

## 2. First pass: before the migration

Every step here must pass with the migration **not** run.

**The gallery.**

1. Click "Creativos" in the sidebar. The address is `/creatives`.
2. The page shows one group, "Todos los reportes", with 12 cards. There is no "Recientes", "Tus reportes" or "Favoritos".
3. "Nuevo reporte" and the stars are disabled. Hovering them says "Los reportes guardados todavía no están disponibles."
4. There is no error message on screen. In the Network tab there is at most one request to `api/creatives/reports`, answered 503, and it is not repeated.
5. Type "land" in the search. Only "Top Landings" stays. Type "zzz". The page says "Ningún reporte coincide con tu búsqueda".

**Opening a report.**

6. Click "Top Hooks". The address ends in `?report=top-hooks`.
7. The first `report` request carries `sort=scroll_stopper_rate` and `format=video`. The chip "Formato Video" is shown.
8. Reload once. The page still shows "Top Hooks" with the same order and filter. This is the check for a bug found and fixed during the build.
9. Sort by ROAS. "Modificado" and "Restablecer" appear. The address now carries the full setup. Paste it in another tab: same page.
10. Press "Restablecer". The address goes back to `?report=top-hooks` alone.
11. Click the report's name. Choose "Top Landings". The view is Totales, the grouping is Landing, and nothing is left from the previous report.

**The gallery view.**

12. On "Top Creativos", check a card against the Figma: thumbnail, format badge, name, four rows of numbers, the verdict and "N ventas".
13. Hover a video card. The video plays inside the card. A request to the ad preview route leaves only on hover.
14. Go to page 2. Change to 12 per page.

**Filters.**

15. On page 2, open "Filtro", then "Estado", and tick "Activo". The request has `status=active` and `offset=0`. The button reads "Filtro (1)".
16. Add "Formato": Video and Carrusel. The chip reads "Video o Carrusel".
17. Open "Campaña". The list comes from `api/creatives/options`. Tick one. Open "Conjunto": only that campaign's ad sets are listed.
18. In "Inversión", set a minimum above the maximum. "Aplicar" stays disabled.
19. Set a minimum far above any real spend. The page says "Ningún creativo cumple estos filtros". "Quitar el último filtro" removes only that one.
20. Reload. The same chips are there, in the same order.

**Grouping and numbers.**

21. "Agrupar", then "Copy". The request has `group=copy`. Cards show the text and "N creativos".
22. Try "Titular". If a line says "Hay $X de inversión sin un titular único.", it is correct, not an error.
23. "+ Métrica". The picker has five groups. "Video" includes "Hold Rate (3s)". Reorder with the arrows: the rows of the cards follow.

**Totales and Diario.**

24. Switch to Totales. Ten groups of two bars. The table sits **below** the bordered card, not inside it.
25. Untick a row: its bars leave. Go to page 2 of the table and tick a row: it is refused with "Puedes comparar hasta 10 creativos a la vez."
26. Click the "ROAS" column header. The order changes, and switching to Galería shows the same order.
27. Switch to Diario. Five lines. A `daily` request leaves with five `key` values. Tick a sixth: a new request with six.

**The Limited role.**

28. As a Limited member, the gallery shows 8 cards. "Top Ganancia", "Top para escalar", "Top para apagar" and "Top de la semana" are missing.
29. Cards have no verdict. No number about profit is offered in the picker. "Filtro" has no "Veredicto".
30. Open `/creatives/report?report=top-ganancia` by hand. The page shows "Top Creativos" and no request is refused.

**A phone.**

31. Set the device width to 390. The gallery shows one card per row. "Filtro", "Agrupar", the picker and the report's name open as sheets from the bottom. In Totales the chart scrolls sideways and the page does not.

## 3. The migration

The file creates three tables and changes nothing that exists. It runs in one transaction and is safe to run twice.

In the code, it is `docs/migrations/036_creative_saved_reports.sql`. Its header says what it creates and how to undo it.

```sql title="docs/migrations/036_creative_saved_reports.sql · L22–L28"
-- Additive and idempotent: one transaction, every statement IF NOT EXISTS. Run it BEFORE the staging
-- deploy of the wave-4 UI (staging writes this database). Until it runs, the routes under
-- /api/creatives/reports answer 503 `saved_reports_unavailable`.
--
-- UNDO (loses every saved report, favourite and recent):
--   DROP TABLE IF EXISTS public.creative_report_recent, public.creative_report_favorite,
--     public.creative_saved_report;
```

**Run it**, in PowerShell, from the app repository. The first line after `Set-Location` copies the five database settings from the local environment file into the session, without printing them.

```powershell
Set-Location C:\Users\Rodrigo\Desktop\escalafy\escalafy-app
Get-Content .env.local | Where-Object { $_ -match '^\s*(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD)\s*=' } | ForEach-Object { $k,$v = $_ -split '=',2; Set-Item "env:$($k.Trim())" $v.Trim().Trim('"').Trim("'") }
$env:PGSSLMODE = 'require'
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -v ON_ERROR_STOP=1 -f docs/migrations/036_creative_saved_reports.sql
```

The output must end in `COMMIT`.

**Check it**, with the same `psql` and `-c "<query>"`:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name LIKE 'creative%' ORDER BY 1;
-- creative_report_favorite, creative_report_recent, creative_saved_report

SELECT count(*) FROM creative_saved_report;
-- 0
```

**Undo it.** This loses every saved report, star and recent.

```sql
DROP TABLE IF EXISTS public.creative_report_recent, public.creative_report_favorite,
  public.creative_saved_report;
```

After the undo, the page goes back to the state of the first pass. No deploy is needed in either direction.

:::info[Why this way]

The page treats "the tables do not exist" as a normal state, instead of requiring the migration before the deploy. The branch can then be deployed and judged before anyone decides to change the shared database, and an undo never breaks the page.

:::

:::warning[Gotcha]

The migration was tested on a throwaway local database, never on the shared one. The local server was a newer major version than the shared one. The statements are plain, so a difference is unlikely, and `ON_ERROR_STOP` with the single transaction means a failure leaves nothing behind.

:::

## 4. Second pass: after the migration

Reload the page. No deploy is needed.

**The gallery.**

1. "Nuevo reporte" and the stars are enabled.
2. "Tus reportes" shows a card that says "Todavía no has creado reportes…". "Favoritos" shows a line about the star.
3. Open five different reports, then go back. "Recientes" shows the last 4, newest first.

**Saving.**

4. On "Top Hooks", sort by ROAS and press "Guardar". Name it "QA 1". The request is a POST whose body has that name, `sort: "meta_roas"`, `date: { preset: "last14" }` and `format: ["video"]`.
5. The address becomes `?report=` followed by an id. The header says "QA 1". There is no "Modificado". "Guardar" is disabled.
6. Try to save another report as "qa 1". The dialog says "Ya hay un reporte con ese nombre." under the field.
7. On "QA 1", change a number. "Modificado" appears and "Guardar" is enabled. Press it. A PATCH leaves, "Modificado" goes away, and a message confirms.
8. Go back to the gallery. "QA 1" is in "Tus reportes".

**The relative range.**

9. Pick "Últimos 7 días" and save as "QA 7". The POST body has `date: { preset: "last7" }`.
10. Pick a range by hand that matches no preset and save as "QA fijo". The body has `start` and `end`.

**New, rename, delete.**

11. "Nuevo reporte" opens "Reporte sin título" at `?report=nuevo`. "Guardar" asks for a name.
12. Rename "QA 1" from the "···" menu of the header, and again from the "···" of its card in the gallery.
13. Delete it from the header. The confirmation says it is removed for the whole organization. After confirming, you are in the gallery and the report is gone.
14. A ready-made report has neither "Renombrar" nor "Eliminar".

**Stars and recents.**

15. Star a card. It fills at once and the report appears in "Favoritos".
16. Set the network to offline and star another. The star goes back and a message says the favourite could not be changed.
17. Open a report and change its order twice. Exactly one `open` request left.

**Another member.**

18. A colleague in the same organization sees your saved reports and not your stars or recents.
19. As a Limited member, open a report that a full member saved sorted by "Ganancia est.". A note says parts are hidden for the role. "Guardar" is disabled. "Guardar como reporte nuevo" works.

**Clean up.** Delete every report you created.

## 5. What to write down

For each failed step, note the step number, the organization's name, the address in the browser and the failing request with its answer. Most steps name the request to look at, so a failure can usually be placed on the page side or the server side from the Network tab alone.

Three results are expected and are not failures:

- Many cards with a placeholder in place of a thumbnail.
- A low-coverage note on organizations where the pipeline has matched few ads to creatives.
- The daily chart taking several seconds on a 90-day range.

All three come from the data pipeline and are listed in [Decisions and open questions](./06-decisions-and-open-questions.md).

## Where to look

| Role | File |
| --- | --- |
| The migration | `docs/migrations/036_creative_saved_reports.sql` |
| The answer the saved-report routes give before the migration | `app/api/creatives/reports/respond.ts` |
| How the server page turns that answer into a state | `app/(app)/(analytics)/creatives/load-saved-reports.ts` |
| The feature's tests (`npm run test:area creatives`) | `test/areas.ts` |

## Terms

- **Staging preview**: the deployment the team uses to review a branch. It reads and writes the production database.
- **Migration**: a file of statements that changes the database's structure. Here it only adds tables.
- **First pass, second pass**: the checks before and after the migration.
