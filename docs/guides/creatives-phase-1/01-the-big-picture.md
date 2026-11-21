---
title: "The big picture"
sidebar_label: "1. The big picture"
sidebar_position: 1
description: "What Creativos is, the two screens it has, the path a number takes from the ad platform to a card, and the nine changes the first release was built in."
---

# The big picture

_After this chapter you can say what the two screens of Creativos are for, name the pieces between the ad platform's numbers and a card on screen, and find which of the nine changes introduced a given piece._

:::tip[In simple terms]

A store that advertises runs many ads. Several ads often show the same picture or the same video. The store's question is rarely "how did this ad do". It is "how did this video do, everywhere it ran". The picture or video is called a creative.

Until now the app could answer by campaign, by ad set and by ad. It could not answer by creative. Creativos adds that answer.

It has two screens. The first is a gallery of reports. A report is a saved way of looking at the creatives: which dates, which filters, which order, which numbers. Twelve reports come ready-made, and a team can save its own.

The second screen is the report itself. It shows the creatives as cards, each with its thumbnail, a few numbers and a verdict that says whether it earns more than it costs. The same creatives can also be seen as a bar chart of totals or as a line chart day by day. The user can filter them, group them (by text, by landing page, by campaign) and choose which numbers to show.

Everything the user chooses on that screen is written into the page's address. Reloading, or sending the link to a colleague, shows the same thing.

The first release covers one ad platform, and it is available on every plan.

:::

## 1. Two routes, one feature

The gallery of reports is the entry. Opening a report goes to the report page with the report's name in the address.

In the code, both routes ask for the same two permissions, the full reports role and the Limited one, and neither sits behind the advanced-features gate.

```ts title="lib/permissions.tsx · L36–L38"
  // Creativos (ESC-799): both report roles, on every plan. The Limited role gets no margin numbers.
  '/creatives': [PERMISSIONS.REPORTS_READ, PERMISSIONS.REPORTS_READ_LIMITED],
  '/creatives/report': [PERMISSIONS.REPORTS_READ, PERMISSIONS.REPORTS_READ_LIMITED],
```

The gallery page is a server component. It checks the permission, reads the organization's saved reports for the first render, and hands both to a client component.

```tsx title="app/(app)/(analytics)/creatives/page.tsx · L17–L27"
export default async function CreativesPage() {
  const { orgId, userId, has } = await auth();
  const canRead =
    has({ permission: PERMISSIONS.REPORTS_READ }) ||
    has({ permission: PERMISSIONS.REPORTS_READ_LIMITED });
  if (!orgId || !canRead) return <NoAccess />;

  const isLimited = has({ permission: PERMISSIONS.REPORTS_READ_LIMITED });
  const savedReports = await loadSavedReports({ orgId, userId, isLimited });
  return <ReportGallery isLimited={isLimited} savedReports={savedReports} />;
}
```

:::info[Why this way]

One sidebar entry and two routes, instead of the folders, tabs and fixed sub-pages of the earlier UX draft. Every fixed screen of that draft (launches, weekly ranking, landings) is the same report page with a different configuration, so each became a ready-made report. See [Decisions and open questions](./06-decisions-and-open-questions.md).

:::

## 2. The path of a number

A number on a card travels through five places.

1. **The ad platform.** It reports spend, impressions, plays and purchases per ad and per day.
2. **The pipeline.** Another team's job copies those numbers into the analytics database and works out which creative each ad shows. It is not part of this repository.
3. **The server function.** It reads the pipeline's tables, converts money into the report's currency, sums the ads of each creative into one row, and decides the verdict.
4. **The route.** It checks who is asking, removes what the Limited role may not see, and answers one page of rows.
5. **The page.** It turns the user's choices into the route's parameters and draws the rows as cards, bars or lines.

Steps 3 and 4 are [The report data](./03-the-report-data.md). Step 5 is [The report page](./04-the-report-page.md). Reports, ready-made and saved, are [Reports](./05-reports.md).

In the code, every route of the feature starts with the same check. It answers who the organization is and whether the member is Limited.

```ts title="app/api/creatives/authorize.ts · L12–L24"
export function authorizeCreativesRequest(
  req: NextRequest
): { orgId: string; isLimited: boolean } | NextResponse {
  const { orgId, has } = getAuth(req);
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (
    !has({ permission: PERMISSIONS.REPORTS_READ }) &&
    !has({ permission: PERMISSIONS.REPORTS_READ_LIMITED })
  ) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return { orgId, isLimited: has({ permission: PERMISSIONS.REPORTS_READ_LIMITED }) };
}
```

:::info[Why this way]

One helper for every route, instead of a permission block copied into each. The Limited rule is the part most likely to be forgotten in a new route, and a route that forgets it leaks the store's margin.

:::

## 3. One page, three views

The report page shows the same creatives in three ways: cards, a bar chart of totals, and a line chart by day. The user switches between them without losing filters, grouping or dates.

In the code, one component chooses the view and gives each the same props. A view that needs more data asks for it itself.

```tsx title="components/creatives/report-view.tsx · L30–L39"
export function ReportView(props: CreativeReportViewProps) {
  switch (props.state.view) {
    case 'totals':
      return <TotalsView {...props} />;
    case 'daily':
      return <DailyView {...props} />;
    case 'gallery':
      return <GalleryView {...props} />;
  }
}
```

:::info[Why this way]

One file per view behind one switch, instead of one large page component. It let the three views be built by different people at the same time, and it keeps a fourth view a matter of one new file and one new case.

:::

## 4. Nine changes, nine commits

The release was built as nine changes. Each has one commit on the branch `feature/esc-799-creativos-ui-fase-1-reporte-de-creativos-con`, and the commit's subject is the change's name.

| # | Commit | Change | What it added |
| --- | --- | --- | --- |
| 1 | `ce444c363` | `esc-799-creative-report-data` | The server function and the route for one page of creatives. |
| 2 | `45fd730db` | `esc-799-creative-report-query` | Filters, grouping, the verdict, the daily series, the filter options, and the shape of a report's configuration with the 12 ready-made definitions. |
| 3 | `77c68279c` | `esc-799-creatives-page` | The sidebar entry, the report page, the gallery view with its card, the video on hover. |
| 4 | `85711b1c9` | `esc-799-creatives-charts` | Totales, Diario and the table under both. |
| 5 | `b0214f5f7` | `esc-799-creatives-controls` | The filter menu and chips, the grouping menu and grouped cards, the metric picker. |
| 6 | `52ed8c741` | `esc-799-creatives-saved-reports-data` | The tables, the migration file and the routes for saved reports, favourites and recents. |
| 7 | `09daa8696` | `esc-799-creatives-report-gallery` | The gallery of reports, the report switcher, "Modificado" and "Restablecer". |
| 8 | `dde67fc21` | `esc-799-creatives-layout-fixes` | The chart views' table moved below the card, and small corrections. |
| 9 | `5f3db0fad` | `esc-799-creatives-saved-reports` | Saving, renaming and deleting reports, the star, and the gallery's groups. |

A tenth commit, `195bfe9ca`, changes no behaviour. It brings the code references of the feature's README up to date after the last change.

The changes were built in four rounds. Within a round, two were built at the same time, each with its own list of files. That is why some shared files (the translations, the feature's README) travel in only one of the two commits of a round.

:::info[Why this way]

Server first, then the page, then what sits on top of the page. Each round could be deployed to the staging preview and looked at before the next one started, instead of one large delivery that could only be judged at the end.

:::

## 5. What has and has not been checked

Every change passed the automated checks: the tests of the feature, the type check, the check that no organization id is written in the code, and formatting.

Nothing has been looked at in a browser with real data. The local setup has no organization with advertising data, so the first real look is on the staging preview. [Trying it on staging](./07-trying-it-on-staging.md) lists what to check, in order.

One database migration is written and not run. Until someone runs it, the page works with the ready-made reports only, and saving is switched off. The same chapter has the command.

## Follow a request

1. **The user** · clicks "Creativos" in the sidebar. The gallery page checks the permission and reads the saved reports (`CreativesPage`).
2. **The user** · clicks the card of a ready-made report. The browser goes to the report page with the report's id in the address.
3. **The report page** · reads the address and builds the page's state from the report's definition (`stateFromAddress`).
4. **The page** · turns that state into request parameters (`reportRequestParams`) and asks the report route.
5. **The route** · checks the member (`authorizeCreativesRequest`), refuses what the Limited role may not ask for, and calls the server function.
6. **The server function** · reads the analytics database, sums each creative's ads, decides the verdict, and returns one page of rows.
7. **The page** · draws the rows through the view the state names (`ReportView`).
8. **The user** · changes the order. The state changes, the address changes with it, and step 4 runs again.

## Where to look

| Role | File |
| --- | --- |
| Who may open the two routes | `lib/permissions.tsx` |
| The gallery of reports (server page) | `app/(app)/(analytics)/creatives/page.tsx` |
| The report page (server page) | `app/(app)/(analytics)/creatives/report/page.tsx` |
| The first step of every route | `app/api/creatives/authorize.ts` |
| The switch between the three views | `components/creatives/report-view.tsx` |
| Everything on the report page | `components/creatives/` |
| The two chart views and their table | `components/creatives/charts/` |
| The gallery of reports, the switcher, saving | `components/creatives/reports/` |
| The server functions | `lib/server-functions/creatives/` |
| The feature's own description | `docs/features/creatives/README.md` |
| The test area (`npm run test:area creatives`) | `test/areas.ts` |

## Terms

- **Creative**: the picture, video or carousel an ad shows. One creative can run in many ads.
- **Report**: a named configuration of the report page: dates, filters, grouping, order, numbers and view.
- **Ready-made report**: one of the 12 reports that ship with the app.
- **Saved report**: a report a team saved under its own name.
- **View**: one of the three ways the report page draws the same creatives: Galería, Totales, Diario.
- **Verdict**: the label on a card that says whether the creative earns more than it costs.
- **Limited role**: the organization role for a media buyer, which never receives the store's margin or profit.
- **Change**: one unit of the build, with its own specification and one commit.
