---
title: "Decisions and open questions"
sidebar_label: "6. Decisions and open questions"
sidebar_position: 6
description: "Every product decision behind phase 1 of Creativos, who took it and what it beat, the defaults the build took without a confirmation, and what is still waiting for an answer."
---

# Decisions and open questions

_After this chapter you can tell which behaviours of Creativos were decided by a person, which are defaults taken during the build, and which are still open. You also know what each open answer would change._

:::tip[In simple terms]

Phase 1 was built from four sources that did not always agree: the ticket, the Figma file, an earlier UX draft and the screenshots of a competing product. Where they disagreed, somebody had to choose.

Some choices were made by Rodrigo, who owns the page. Some were proposals by Mateo, who owns the design, that Rodrigo accepted. Those are settled, and this chapter lists them with the option each one beat.

Other choices were made during the build, because the work could not wait for an answer. Each of those was the option that is cheapest to reverse. They are listed apart, with what reversing each one takes, so nobody mistakes a default for a decision.

A third group is open. Nobody has answered yet, and the page shows a reasonable placeholder in the meantime.

The last list is what was left out of phase 1 on purpose.

:::

## 1. The order of authority

When two sources disagreed, the build followed them in this order.

| Order | Source | Why it ranks there |
| --- | --- | --- |
| 1 | The ticket's section "Requisitos de UI — diseño aprobado (2026-11-20)" | Mateo wrote it after the Figma was final. It is the newest statement of intent. |
| 2 | The Figma "Final" frames | They show layout and wording the ticket does not spell out. |
| 3 | The reports of earlier build steps | They describe what the code already does. |
| 4 | Older ticket text and the UX draft | They predate the approved section and contradict it in places. |

One rule sits above all four: a test in the repository wins over any of them. That is how the Spanish wording was settled (see section 3).

## 2. Decisions taken by a person

| Topic | Decision | Taken by | What it beat |
| --- | --- | --- | --- |
| Structure | One sidebar entry. It opens a gallery of reports. Opening a report shows the report page. | Rodrigo | The UX draft's folders, tabs and fixed sub-pages. |
| Plans | Available on every plan. | Rodrigo, from the ticket | Putting it behind the advanced-features gate. |
| Platforms | Meta only. The platform selector exists and offers one option. | Ticket | Waiting for TikTok and Google data. |
| Paging | The gallery pages 8 cards at a time, with an option of 12. | Mateo's proposal, accepted by Rodrigo | Endless scroll, which Rodrigo first preferred. |
| Verdict | The card shows a verdict in phase 1, computed from Meta's own numbers and labelled as such. | Mateo's proposal, accepted by Rodrigo | Hiding the verdict until order-level attribution exists. |
| Profit | "Ganancia" is the existing estimated profit and is labelled "Ganancia est.". | Rodrigo | Calling it profit without the qualifier. |
| Video | A video plays inside the card on hover. The playable address is requested on hover only. | Rodrigo | Fetching every card's video address when the page loads. |
| Hold rate | Creativos uses ThruPlays ÷ 3-second plays, as a new metric. | Rodrigo | Changing the existing hold rate, which other pages already show. |
| Filters | A fixed list of eight filters. | Rodrigo, from Mateo's table | A free filter builder over any metric. |
| Grouping | Nine groupings. A group's card shows its top creative's thumbnail and the number of creatives. | Mateo's proposal, accepted by Rodrigo | Text-only cards for groups that are not creatives. |
| Charts | Totales and Diario share a table below the chart. A ticked row is a series. At most 10. | Rodrigo, from the Figma | A separate selection screen. |
| Reports | 12 ready-made reports, read-only. Saved reports are shared with the organization. Favourites and recents belong to each user. | Rodrigo | Personal saved reports. |
| First release | The report page, saving reports and the gallery of reports. | Rodrigo | Shipping the report page alone. |

## 3. Defaults taken during the build

Nobody confirmed these. Each one was chosen because it is cheap to reverse.

| Topic | Default in the code | Reversing it takes |
| --- | --- | --- |
| Limited role and the verdict | A member with the Limited role gets no verdict, no break-even figure and no estimated profit. Those three would let a media buyer work out the store's margin. | One condition in the report route and in the card. |
| Limited role and ready-made reports | Four ready-made reports are hidden for that role, because each sorts by profit or filters by verdict: "Más ganancia", "Listos para escalar", "A apagar", "Ranking de la semana". | One rule in the list of ready-made reports. "Ranking de la semana" could stay, ranked by spend. |
| Limited role and saved reports | A saved report that uses profit or verdict is shown to that role with those parts removed. The member cannot overwrite it, and can save a copy. | A route check. |
| Who edits a saved report | Any member who can open the page may rename, overwrite or delete any saved report of the organization. | A route check. The creator is already stored, so no migration. |
| Spanish wording | Tú, not voseo. A repository test forbids voseo, so this is not a preference. | Changing the test and every string. |
| Report card | One muted line of description and three grey placeholder tiles. The ticket says no description. The Figma shows the report's top three creatives. | Removing a line. Real thumbnails need one batched request for all cards. |
| The twelfth report | "Formatos", as the server defines it. The ticket's open point proposes "Mejores titulares". | Editing one definition. |
| Recents | 8 are stored, 4 are shown. | A constant. |
| Saved report's range | A preset such as "últimos 14 días" stays relative. A custom range stays fixed. | A line in the function that builds the saved configuration. |
| Saved report's colour and icon | Derived from the report's id. The ticket proposes a colour assigned on creation and one generic icon. | A column and a picker. |
| "Nuevo reporte" | Opens an untitled report with the default setup. Nothing is stored until its first "Guardar". | Changing one branch of the open-report logic. |
| "Renombrar" | Placed in the "···" menu of the header and of a saved report's card. Neither the ticket nor the Figma places it. | Editing two menus. |
| "Guardar" and "Nuevo reporte" | Primary buttons, as the ticket says. The Figma draws them secondary. | One property on each button. |
| Dialogs on a phone | Centred dialogs. The design system has no bottom-sheet dialog. | A sheet variant of the dialog in the design system. |
| Empty groups of the gallery | "Tus reportes" and "Favoritos" show a short invitation when empty, with the ticket's text. | Removing two properties. |
| A range equal to a preset | A hand-picked range that happens to equal "últimos 14 días" is saved as that preset, because the date picker cannot say which preset was chosen. | One new argument on the picker's callback. |
| The star in the switcher | Works with the mouse only. The keyboard cannot reach it inside the list. | A different list structure. |
| Chart selection | Kept in memory, one per view, and reset when the range, filters or grouping change. Not in the address. | Adding it to the address, or to the saved report. |
| Table header | No "select all" checkbox. The ticket's Totales section asks for one. The build brief said none. | Turning on the table's built-in row selection. |
| Metric picker | Metrics are reordered with up and down buttons. The Figma draws drag handles. | Replacing the buttons with a sortable list. |

:::warning[Gotcha]

Two of the twelve ready-made reports have no agreed thresholds: "Listos para escalar" and "A apagar". They ship with a definition that filters by status and verdict only, and their cards say so. A reader who expects a minimum spend will not find one in the code.

:::

## 4. Open with Mateo

- Does a Limited member see the verdict? The default says no.
- What does a card look like for a grouping that is not a creative? The build follows his own proposal. He has not seen it built.
- "Formatos" or "Mejores titulares" as the twelfth report.
- The thresholds of "Listos para escalar" and "A apagar".
- The "select all" checkbox in the table header.
- Up and down buttons in place of drag handles.
- On a grouped card, "N creativos" replaces "N ventas". Should both show?
- The line that reports spend with no single key also shows when grouped by creative. Should it?
- The bar chart has no vertical axis and the line chart has no legend, as in the Figma. Confirm both.
- Folders. The ticket asks for them. The Figma has four groups and no folder. They are not built.

## 5. Open with the data pipeline

These depend on the pipeline that fills the tables the report reads (ticket ESC-796).

- **Fees.** The per-creative table has no fee column, so estimated profit for a creative does not subtract platform fees the way the dashboard does.
- **Coverage.** In at least one large account the rows explain a very small share of the spend. The page shows a low-coverage note in that case. The cause is upstream.
- **Thumbnails.** Most creatives have no thumbnail yet, because the media table is still filling. The card shows a placeholder for its format.
- **Speed.** The report takes 2 to 3 seconds and the daily series 3 to 9 seconds at 90 days. Nothing is cached yet.
- **Not delivered by the pipeline:** the retention curve of a video, exact reach for a range, the history of status changes, the video files themselves, and landing screenshots.

## 6. Left out of phase 1 on purpose

- The detail screen of a creative. A click on a card does nothing.
- The naming convention and anything parsed from an ad's name.
- Tags and notes.
- Comparison with the previous period.
- Filters by video length, by any metric, or by landing.
- The public share link.
- Scores.
- CSV export.
- Exposing any of it through the MCP connector.
- The "Etapa" filter (Lanzado, Escalado, Ganador). Its threshold is not defined.

## Where to look

| Role | File |
| --- | --- |
| The feature's own description, kept current with the code | `docs/features/creatives/README.md` |
| The terms the feature uses | `docs/features/creatives/GLOSSARY.md` |
| The test that forbids voseo | `lib/i18n/messages-completeness.test.ts` |
| The definitions of the 12 ready-made reports | `lib/server-functions/creatives/report-config.schema.ts` |

The mechanisms behind each decision are in [The report data](./03-the-report-data.md), [The report page](./04-the-report-page.md) and [Reports](./05-reports.md).

## Terms

- **Limited role**: the organization role for a media buyer. It reads ad numbers and never the store's margin or profit.
- **Verdict**: the label on a card that says whether a creative earns more than it costs, from Meta's return on ad spend against the store's break-even.
- **Ready-made report**: one of the 12 reports defined in code. It can be opened, starred and copied, never changed.
- **Saved report**: a report an organization saved under a name. Every member sees it.
- **Default**: in this chapter, a behaviour chosen during the build without a person confirming it.
