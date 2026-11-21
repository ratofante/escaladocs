---
title: "The report data"
sidebar_label: "3. The report data"
sidebar_position: 3
description: "What one row of the creative report is, where each of its numbers comes from, and how grouping, filters, the remainder, the coverage, the verdict and the viewer's role shape the answer."
---

# The report data

*After this chapter you can say what one row of the creative report is and where each of its numbers comes from, and predict how a grouping, a filter or the viewer's role changes the answer. You can also read the remainder, the coverage and the verdict without guessing.*

<small>~12 min · Built on: ESC-799, ESC-796, docs/features/creatives/README.md</small>

:::tip[In simple terms]

A store runs many ads on Meta, and one video or image often appears in several of them. The report answers "how did each piece do": one row per piece, with the numbers of every ad that used it added up. The row takes its name and its preview from the ad that spent the most with it.

The browser sends a date range, a currency, the number to sort by and the page it wants, and can add filters and a grouping. The server checks that the person may read reports, fully or in the limited media buyer role, then the request and the plan. Only then does it read data.

The numbers come from the analytics database, prepared by another team's pipeline: one line per piece and per ad over the range. Money is converted with the Ads report's rule. Then the app's own code filters, groups, computes ratios from the sums, sorts and cuts the page.

Some spend cannot be tied to any row. It comes back apart, and a coverage figure says how much of the accounts' spend the report explains.

For a full reader each row also gets a verdict: does Meta's return beat the return at which the store breaks even? A limited member receives no estimated profit, no verdict and no break-even value, because next to the visible numbers they would give away the store's margin.

Two smaller requests feed the line chart and the campaign and ad set filters.

:::

## 1. A creative, and the row built for it

A creative is the main piece of an ad: its video, image, carousel or catalog set. One creative can run in many ads. The report reads, once per request, one line per creative and per ad that used it, with what filters and groupings need about the ad. In the default grouping, the lines of one creative add up to its row. The ad that spent the most with it, the top ad, names the row.

In the code, the data comes from views built by another team's pipeline (ESC-796). `creative_daily` holds the spend and counters of each creative in each ad, per day. `creative_attributes` holds each creative's format, media, ad counts, first day with spend and status. `creative_ad_map` holds each ad's landing and the fingerprints of its texts. `ad_performance` adds each ad's campaign and ad set, `ad_objects` its latest name and status. `loadCreativeScope` runs the metrics query, the attributes query and the store margin in parallel (`lib/server-functions/creatives/get-creative-report.ts · L415–L433`), or returns the empty report without a Meta account (`L403–L413`). The metrics travel as one array, `vals`, to keep the answer small (`L165–L167`).

```ts title="lib/server-functions/creatives/get-creative-report.ts · L241–L254"
    SELECT
      c.creative_key AS creative_key,
      c.ad_id AS ad_id,
      stripCopySuffix(n.ad_name) AS ad_label,
      n.ad_status AS ad_status,
      p.campaign_id AS campaign_id,
      p.adset_id AS adset_id,
      ${textColumns}
      t.account_spend AS account_spend,
      [${CREATIVE_BASE_METRIC_IDS.map((id) => `c.${id}`).join(', ')}] AS vals
    FROM ad_total AS t
    LEFT JOIN per_ad AS c ON c.one = t.one
    LEFT JOIN ad_info AS n ON n.object_id = c.ad_id
    LEFT JOIN ad_parent AS p ON p.ad_id = c.ad_id${textJoin}
```

`buildCreativeRows` adds the lines of each key and keeps, per creative, the ad with the highest spend (`lib/server-functions/creatives/build-creative-rows.ts · L103–L129`). That ad's name, without Meta's " - Copia N", is the row's `name`, and its id is `top_ad_id`, which the page uses to ask for the video (`L149–L159`). Missing media is `null` (`L164–L167`). On 2026-11-20 the pipeline's media table was still filling, so most thumbnails were missing (`docs/features/creatives/README.md`). At 90 days the report took 2.3 to 3.4 seconds for the organizations with the most ads (`docs/personal/teach/esc-799-creative-analytics/reference/reports/wave1-server.md · L156–L162`).

The request takes `start`, `end`, `currency`, `sort` (default `meta_ad_spend`), `dir`, `limit` (1 to 100, default 24), `offset`, the grouping and the filters (`lib/server-functions/creatives/get-creative-report.schema.ts · L176–L192`). The answer echoes the range, sort and grouping and carries `total`, `rows`, `totals`, `unassigned`, `coverage` and, for a full reader, `break_even_roas` (`L424–L451`).

:::info[Why this way]

Filtering and grouping in SQL was the alternative: each of nine groupings and eight filters would be a variant of one long query, and the daily series would need the same logic again. A few thousand creative-and-ad lines are cheap to filter and add up in TypeScript, and that code is pure and tested in node.

:::

## 2. Money in one currency

An organization's ad accounts can be in different currencies, and it can set a fee per account, such as an agency fee. Every amount is converted to the requested currency with the Ads report's rule, and spend includes the fee, so the two reports agree on an ad's spend.

In the code, `rateExpr` is the CASE of the Ads report's `rated` block (`lib/server-functions/reporting/ad-performance.ts · L512–L524`), built on the helpers that file exports (`L110–L112`). The CASE itself is a copy: an edit to it goes in both files. The views have no fee column, so `baseStages` reads each account-day's spend and fee from `ad_performance` and applies that day's fee ratio to every creative line of the account (`get-creative-report.ts · L109–L123`). `meta_ad_spend` is spend plus fee; `meta_original_ad_spend` is Meta's spend alone (`lib/server-functions/reporting/meta.tsx · L80–L82`).

```ts title="lib/server-functions/creatives/get-creative-report.ts · L65–L78"
/**
 * The Ads report's rate for a row set aliased `b` that exposes `currency`, `currency_rate` and
 * `event_date` (the `rated` block of `executeAdPerformanceQuery`, unchanged).
 */
function rateExpr(preferredArs: string) {
  const srcToUsd = srcToUsdRateExpr(preferredArs);
  return `CASE
          WHEN b.currency = tgt
            OR ((b.currency LIKE 'ARS%' OR b.currency = 'ARS') AND tgt_is_ars)
            THEN 1.0
          WHEN tgt = 'USD' THEN ${srcToUsd}
          ELSE ${srcToUsd} * if(fx.usd_to_tgt = 0, 1.0, fx.usd_to_tgt)
        END`;
}
```

:::info[Why this way]

A conversion of its own was the alternative, and it would let one ad show two spends on two pages. Deriving the fee beat waiting for the data team to add it to the view: it is a percentage set per account, so one account-day has one ratio (`get-creative-report.ts · L92–L97`).

:::

## 3. Grouping

The same lines can be added up by ad name, copy, headline, landing, launch week, campaign, ad set or the creative's type. Each row is then one group, with a label, the number of distinct creatives inside, and the media of the one that spent the most, so a grouped card still has a picture. A line with no key in the grouping goes to the remainder.

In the code, `groupKeyOf` gives each line its key. An empty key means the remainder.

```ts title="lib/server-functions/creatives/creative-row-scope.ts · L177–L198"
  switch (group) {
    case 'creative':
      return row.creative_key === UNASSIGNED_CREATIVE_KEY ? '' : row.creative_key;
    case 'ad':
      return row.ad_label.trim();
    case 'copy':
      return row.copy;
    case 'headline':
      return row.headline;
    case 'landing':
      return row.landing;
    case 'launch_week': {
      const launch = attributesByKey.get(row.creative_key)?.first_spend_date?.slice(0, 10);
      return launch ? weekStartOf(launch) : '';
    }
    case 'campaign':
      return row.campaign_id;
    case 'adset':
      return row.adset_id;
    case 'format':
      return displayFormatOf(attributesByKey.get(row.creative_key)) ?? '';
  }
```

A copy or headline key is a fingerprint, a short hash of the text, given only when the ad has exactly one text of that kind (`get-creative-report.ts · L189–L192`). Weeks start on Sunday (`WEEK_STARTS_ON`, `lib/datePresets.ts · L66`). `toRow` fills the group row from its top creative (`build-creative-rows.ts · L142–L178`). Rows sort by the requested metric over every group, ties by key, and only then is the page cut (`L242–L255`). For copy, headline, campaign and ad set, `nameRows` then reads the labels of that page's keys (`get-creative-report.ts · L354–L365`).

:::info[Why this way]

Grouping copy and headline on `creative_text_daily`, the pipeline's per-text view, was the alternative. It has no creative key, so no thumbnail, and lacks reach, ThruPlays and the click and view split (`docs/features/creatives/README.md`). Today both give the same numbers.

:::

## 4. The remainder and the coverage

By creative, the remainder is the share of dynamic ads Meta did not attribute to a single piece. In another grouping it is whatever has no key there, such as ads with several headlines. It counts in the totals, so every grouping has the same totals. Ads whose creative the pipeline does not know never reach the report. The coverage says how much of the accounts' Meta spend the report explains.

An example, with no fee. The accounts spent 10,000: 8,000 in normal ads, 1,200 in dynamic ads (500 attributed to pieces, 700 not) and 800 in ads with no known creative. By creative, the rows add up to 8,500, the remainder is 700, the totals are 9,200 and the coverage is 9,200 ÷ 10,000 = 0.92. By headline, rows and remainder change; totals and coverage do not. The Ads report shows 10,000, and the gap is the 800 the views do not hold.

In the code, the line with creative key `unassigned` is the unattributed part of dynamic ads (`get-creative-report.schema.ts · L266`). `ad_total` is the accounts' whole platform spend, which every line carries (`get-creative-report.ts · L155–L157`). Coverage is added up before any filter:

```ts title="lib/server-functions/creatives/build-creative-rows.ts · L196–L212"
  // Every row repeats the accounts' spend; a key of '' is the row the query emits to carry it
  // when no creative matched.
  const accountSpend = metricRows[0]?.account_spend ?? 0;
  const dataRows = metricRows.filter((row) => row.creative_key !== '');

  // Coverage is a property of the data, not of the filters: every row counts.
  let coveredSpend = 0;
  const groups = new Map<string, GroupAccumulator>();
  for (const row of dataRows) {
    const base = baseMetricsOf(row);
    coveredSpend += base.meta_original_ad_spend;
    if (!rowPassesFilters(row, filters, attributesByKey)) continue;
    const key = groupKeyOf(row, group, attributesByKey);
    const acc = groups.get(key) ?? newAccumulator();
    accumulate(acc, row, base);
    groups.set(key, acc);
  }
```

Both sides are platform spend without fee, and `coverage` is `null` when the accounts did not spend (`L259`). The remainder counts in the totals only if it passes the spend and verdict filters (`L219–L228`). On real data, 72.6% of one large organization's 14-day spend had no single headline, so grouping by headline left most of it in the remainder (`wave1-server.md · L167–L168`).

:::info[Why this way]

Dropping the remainder was the alternative, and then the totals would change with the grouping. The coverage ignores filters because it describes the data, not the selection.

:::

## 5. The verdict and break-even ROAS

The store's margin is the share of revenue left after costs over the range. A ROAS of 1 ÷ margin makes the estimated profit zero: that is the break-even ROAS. A row whose Meta ROAS is within 5% of it either way is `break_even` ("En el límite"), above is `profitable`, below is `unprofitable`. No margin, or no spend, means no verdict.

In the code, `getStoreMargin` takes net store revenue over store revenue from the orders report (`lib/server-functions/reporting/get-store-margin.ts · L26–L33`). The estimated profit reads the same margin (`lib/pixel/est-metrics.ts · L38–L43`). The band is `CREATIVE_VERDICT_BAND`, 0.05, both ends included (`get-creative-report.schema.ts · L113–L114`).

```ts title="lib/server-functions/creatives/creative-row-scope.ts · L65–L84"
export function breakEvenRoas(margin: StoreMargin): number | null {
  if (!(margin.store_revenue > 0)) return null;
  if (!(margin.store_margin > 0 && margin.store_margin < 1)) return null;
  return 1 / margin.store_margin;
}

/**
 * Meta's ROAS against the break-even ROAS: within ±5% of it is "break_even", above is
 * "profitable", below is "unprofitable". No verdict without a break-even ROAS or without spend.
 */
export function creativeVerdict(
  metrics: CreativeMetrics,
  breakEven: number | null
): CreativeVerdict | null {
  if (breakEven === null || !(metrics.meta_ad_spend > 0)) return null;
  const roas = metrics.meta_roas ?? 0;
  if (roas > breakEven * (1 + CREATIVE_VERDICT_BAND)) return 'profitable';
  if (roas < breakEven * (1 - CREATIVE_VERDICT_BAND)) return 'unprofitable';
  return 'break_even';
}
```

The builder computes the break-even once (`build-creative-rows.ts · L190–L191`) and a verdict for the remainder and each row (`L224`, `L234`). The answer carries `break_even_roas` once and a `verdict` per row (`L238`, `L261`).

:::info[Why this way]

Reading the sign of the estimated profit was the alternative. Outside the band both agree: ROAS and estimated profit use the same spend with fee (`meta.tsx · L80–L81`) and the same margin. The band adds a middle value, where a sign would call one cent of profit profitable.

:::

## 6. The Limited role

The Limited role is the media buyer role, which must not learn the store's margin. With Meta's ROAS on screen, the estimated profit, the verdict or the break-even ROAS would each give it away. So the server never computes them for that role, never fetches the margin, and sends no `verdict` or `break_even_roas` keys at all. Sorting by an estimated metric or filtering by verdict is a 400.

In the code, `authorizeCreativesRequest` lets in either reports permission and sets `isLimited` when the session has `org:reports:read_limited`, so a member with both counts as Limited (`app/api/creatives/authorize.ts · L17–L23`). The hidden metrics are the Ads report's `LIMITED_HIDDEN_PIXEL_COLUMNS` (`lib/metrics/limited-metrics.ts · L75–L83`). The route refuses before the plan check:

```ts title="app/api/creatives/report/route.ts · L28–L37"
  const parsed = creativeReportQuerySchema.safeParse(
    readCreativeSearchParams(req.nextUrl.searchParams)
  );
  if (
    !parsed.success ||
    (isLimited &&
      (LIMITED_HIDDEN_PIXEL_COLUMNS.includes(parsed.data.sort) || parsed.data.verdict.length > 0))
  ) {
    return NextResponse.json({ error: 'Invalid params' }, { status: 400 });
  }
```

Below the route, `loadCreativeScope` skips `getStoreMargin` (`get-creative-report.ts · L432`), no estimated formula is loaded (`build-creative-rows.ts · L190–L191`), and the builder throws for any other caller that asks (`L185–L188`, `lib/server-functions/creatives/errors.ts · L1–L22`).

:::info[Why this way]

Sending the verdict to the Limited role was rejected: the band's edges give away the break-even ROAS and so the margin, the reason the Ads report hides true ROAS from it (`docs/features/creatives/README.md`). Not computing the numbers, instead of computing and removing them, leaves nothing to forget to remove.

:::

## 7. Filters, the daily series and the filter options

Filters drop lines before grouping: AND between filters, OR inside one. Status, campaign, ad set and name look at each ad, format and launch date at the creative, so a creative keeps only its ads that pass. Spend range and verdict look at the finished row.

In the code, a list is a repeated parameter (`status=active&status=paused`), because a landing or a name can contain a comma (`get-creative-report.schema.ts · L116–L117`, `L248–L263`). `rowPassesFilters` applies the line filters (`creative-row-scope.ts · L139–L164`) and the builder the row filters (`build-creative-rows.ts · L214–L217`). The rule is stated in `lib/server-functions/creatives/report-config.schema.ts · L50`.

`GET /api/creatives/daily` takes the report's range, currency, grouping and filters, one `metric` and 1 to 10 `key` (`get-creative-report.schema.ts · L220–L234`). Spend and verdict filters are accepted and not applied: they choose rows, never change one. Limited gets the report's refusals (`app/api/creatives/daily/route.ts · L29–L35`). `getCreativeDaily` runs the report's read, then reads the chosen ads day by day (`lib/server-functions/creatives/get-creative-daily.ts · L33–L60`), matching lines to keys as the report does:

```ts title="lib/server-functions/creatives/build-creative-daily.ts · L46–L53"
  for (const row of input.metricRows) {
    if (row.creative_key === '') continue;
    if (!rowPassesFilters(row, input.filters, attributesByKey)) continue;
    const key = groupKeyOf(row, input.group, attributesByKey);
    if (key === '' || !wanted.has(key)) continue;
    keyByPair.set(pairOf(row.creative_key, row.ad_id), key);
    adIds.add(row.ad_id);
  }
```

It answers `days`, every day of the range, and one series per key in the order asked, zeros where nothing ran (`build-creative-daily.ts · L96–L109`). At 90 days it took 3.2 to 8.6 seconds (`wave1-server.md · L156–L162`).

`GET /api/creatives/options?start=…&end=…` answers the Meta campaigns and ad sets that spent in the range, named from `ad_objects` (`null` when not synced), ordered by name (`lib/server-functions/creatives/get-creative-filter-options.ts · L15–L43`, `L80–L84`). Both roles get the same answer (`app/api/creatives/options/route.ts · L12–L15`).

:::info[Why this way]

For the daily series, one read of every creative, ad and day was the alternative: hundreds of thousands of rows for a large organization at 90 days. Two reads cost more time but keep one definition of what a key holds.

:::

:::warning[Gotcha]

Two hold rates, two denominators. `hold_rate` already existed: ThruPlays ÷ impressions. Creativos needs ThruPlays ÷ 3-second plays, so a new id, `meta_video_hold_rate` ("Hold Rate (3s)"), was added and the old one left untouched (`lib/const/metric-keys.ts · L93–L95`, `lib/const/metrics.tsx · L1111–L1126`). The ready-made reports use the new one. A dynamic ad's piece has no ThruPlays of its own, so its value is 0 (`docs/features/creatives/README.md`).

```ts title="lib/metrics/calculated/meta.ts · L30–L39"
  hold_rate: {
    dependencies: ['meta_thruplays', 'meta_impressions'],
    formula: (row) =>
      row.meta_impressions > 0 ? row.meta_thruplays / (row.meta_impressions || 1) : 0,
  },
  // Creativos (ESC-799): of the people who watched 3 seconds, the share that reached a ThruPlay.
  meta_video_hold_rate: {
    dependencies: ['meta_thruplays', 'meta_video_plays'],
    formula: (row) => (row.meta_video_plays > 0 ? row.meta_thruplays / row.meta_video_plays : 0),
  },
```

:::

## Follow a request

A full reader opens a report grouped by headline, with only active ads. How the page builds this request is in [The report page](./04-the-report-page.md); what the user sees is in [Using the page](./02-using-the-page.md).

1. **Browser** · `GET /api/creatives/report?start=…&end=…&currency=USD&group=headline&status=active`.
2. **Route** · `authorizeCreativesRequest`: 401 without an organization, 403 without either reports permission. Here `isLimited` is false.
3. **Route** · `readCreativeSearchParams` and `creativeReportQuerySchema`: 400 on an invalid value or a backwards range. Then `assertOrgAccess`, the plan block.
4. **Route** · `withQueryContext` labels every ClickHouse query `app:creatives:api:<orgId>` in `system.query_log` (`lib/server-functions/database/query-context.ts · L49`) and calls `getCreativeReport`.
5. **`loadCreativeScope`** · `loadOrgAdConfigs` finds the Meta accounts. The metrics query, with each ad's single headline fingerprint, the attributes query and `getStoreMargin` run in parallel.
6. **`buildCreativeRows`** · adds the coverage over every line, keeps active ads with `rowPassesFilters`, groups by headline with `groupKeyOf` (ads with no single headline go to the remainder), computes formulas and verdicts, sorts and cuts the page.
7. **`nameRows`** · reads the headline text of the page's keys only.
8. **Route** · answers 200 with the report. A failure is logged and answered 500 `{ error: 'Unavailable' }`.

## Where to look

| Role | File |
| --- | --- |
| Current behaviour of the feature | `docs/features/creatives/README.md` |
| Vocabulary | `docs/features/creatives/GLOSSARY.md` |
| Server contract, decisions, measurements | `docs/personal/teach/esc-799-creative-analytics/reference/reports/wave1-server.md` |
| Permission step of the three routes | `app/api/creatives/authorize.ts` |
| The report route | `app/api/creatives/report/route.ts` |
| The daily route | `app/api/creatives/daily/route.ts` |
| The filter options route | `app/api/creatives/options/route.ts` |
| Request schemas, row and answer types, band (client-safe) | `lib/server-functions/creatives/get-creative-report.schema.ts` |
| The reads and the rate | `lib/server-functions/creatives/get-creative-report.ts` |
| Filters, group keys, formulas, break-even, verdict | `lib/server-functions/creatives/creative-row-scope.ts` |
| Rows, top ad, totals, remainder, coverage, sort and page | `lib/server-functions/creatives/build-creative-rows.ts` |
| Daily series: the two reads | `lib/server-functions/creatives/get-creative-daily.ts` |
| Daily series: keys and sums | `lib/server-functions/creatives/build-creative-daily.ts` |
| Filter options | `lib/server-functions/creatives/get-creative-filter-options.ts` |
| AND and OR rule, report configuration | `lib/server-functions/creatives/report-config.schema.ts` |
| Errors for callers below the route | `lib/server-functions/creatives/errors.ts` |
| The Ads report's rate | `lib/server-functions/reporting/ad-performance.ts` |
| Meta spend with and without fee | `lib/server-functions/reporting/meta.tsx` |
| The store margin | `lib/server-functions/reporting/get-store-margin.ts` |
| Estimated profit | `lib/pixel/est-metrics.ts` |
| What the Limited role must not receive | `lib/metrics/limited-metrics.ts` |
| Week start | `lib/datePresets.ts` |
| Query label in `system.query_log` | `lib/server-functions/database/query-context.ts` |
| The two hold rates | `lib/metrics/calculated/meta.ts`, `lib/const/metric-keys.ts`, `lib/const/metrics.tsx` |

## Terms

- **creative**: The main piece of an ad (video, image, carousel, catalog set, post), which several ads can share; the default row.
- **creative key**: The creative's stable identity from the pipeline, such as `video:<id>`.
- **top ad**: The ad that spent the most with a creative in the range; it names the row and gives `top_ad_id`.
- **fee**: The surcharge an organization sets per ad account; inside `meta_ad_spend`, outside `meta_original_ad_spend`.
- **grouping**: What one row is: creative, ad name, copy, headline, landing, launch week, campaign, ad set or format. (UI: "Agrupar")
- **key / label**: A row's identity inside its grouping, and what it is called.
- **fingerprint**: A short hash of an ad's text; the copy and headline key.
- **remainder (`unassigned`)**: The numbers with no key in the grouping; never a row, always in the totals.
- **coverage**: The share of the accounts' Meta platform spend that maps to a creative, remainder included.
- **break-even ROAS**: 1 ÷ the store's margin, the ROAS at which estimated profit is zero.
- **verdict**: A row's Meta ROAS against the break-even ROAS, with a ±5% band. (UI: "Rentable", "En el límite", "No rentable")
- **Limited role**: The media buyer role, `org:reports:read_limited`; never receives estimated profit, verdict or break-even.
- **hold rate (3s)**: `meta_video_hold_rate`, ThruPlays ÷ 3-second plays; not `hold_rate`.
