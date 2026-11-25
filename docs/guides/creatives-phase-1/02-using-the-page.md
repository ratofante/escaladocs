---
title: "Using the page"
sidebar_label: "2. Using the page"
sidebar_position: 2
description: "Creativos from the user's side: the gallery of reports, the report with its three views, filters, grouping, the choice of numbers, and saving a report for the team."
---

# Using the page

_After this chapter you can walk a user through Creativos from the sidebar to a saved report, and say what each control does and what it does not do yet._

:::tip[In simple terms]

A user comes to Creativos with a question about their ads' pictures and videos. Which ones are worth more budget. Which ones should be switched off. Which opening seconds make people stop scrolling.

They start in a gallery of reports. Each report is one such question, already set up. They open one and see the creatives as cards, best first.

From there they can narrow the list with filters, change what one card stands for (a creative, a text, a landing page, a campaign), choose which numbers each card shows, and switch from cards to a chart.

When the page shows what they want to see every week, they save it under a name. The whole team then finds it in the gallery. Each person can also star the reports they use most.

This chapter has no code. It describes what is on screen, in the order a user meets it.

:::

## 1. The gallery of reports

"Creativos" in the sidebar opens the gallery. It has a search box, a "Nuevo reporte" button and up to four groups of cards.

| Group | What it holds | Who sees it |
| --- | --- | --- |
| Recientes | The last 4 reports this person opened | Only that person |
| Tus reportes | The reports the organization saved | Every member |
| Favoritos | The reports this person starred | Only that person |
| Todos los reportes | The 12 ready-made reports | Every member |

A card shows the report's name, one line about it, a colour mark and an icon. Hovering it shows a star. A saved report's card also has a "···" menu with "Renombrar" and "Eliminar reporte".

The search narrows every group as the user types, and ignores accents.

The 12 ready-made reports:

| Report | The question it answers |
| --- | --- |
| Top Creativos | Everything that ran, by spend. |
| Top Ganancia | Which creatives leave the most estimated profit. |
| Top Inversión | Where the budget went. |
| Top Hooks | Which videos stop the scroll in the first 3 seconds. |
| Top Retención | Which videos keep people watching after those 3 seconds. |
| Top Copies | Which ad texts get the most clicks, across the creatives that use them. |
| Top Lanzamientos | What was launched in the last 30 days, by spend. |
| Top para escalar | Active creatives the verdict calls profitable, best return first. |
| Top para apagar | Active creatives the verdict calls unprofitable, biggest spend first. |
| Top de la semana | The last 7 days ranked by estimated profit, as a bar chart. |
| Top Landings | Spend and return by the page the ad sends people to, as a bar chart. |
| Top Headlines | Which headlines get the most clicks, across the creatives that use them. |

A member with the Limited role sees 8 of them. The other four depend on profit or on the verdict, which that role does not receive.

## 2. The report: the header

Opening a card shows the report page. Its header has, from left to right:

- **"Creativos /"**, which goes back to the gallery.
- **The report's name.** It is a menu: a search, the same groups as the gallery, and "Ver todos los reportes". Choosing another report replaces everything on the page with that report's setup.
- **"Modificado"**, which appears once the user changes anything that the report defines, with **"Restablecer"** to go back to the report as defined. Changing the page number does not count.
- **The platform.** It offers one option for now.
- **"Guardar"**, **"Nuevo reporte"** and a **"···"** menu.

Below the header, a toolbar holds the date range, "Filtro" and "Agrupar". The page has no currency control: amounts are shown in the currency the user chose elsewhere in the app.

## 3. Filters

"Filtro" opens the list of filters.

| Filter | How it is set |
| --- | --- |
| Estado | Tick Activo, Pausado or both. |
| Formato | Tick Video, Imagen, Carrusel, Catálogo. |
| Campaña | Search and tick campaigns. |
| Conjunto | Search and tick ad sets. Only those of the ticked campaigns are listed. |
| Nombre contiene | Type a text and press "Aplicar". |
| Inversión | A minimum, a maximum or both, in the report's currency. |
| Fecha de lanzamiento | A date range. |
| Veredicto | Tick Rentable, En el límite, No rentable. Not offered to the Limited role. |

Each applied filter becomes a chip, for example "Formato Video o Carrusel". Clicking the chip edits it. Its × removes it. "Quitar filtros" removes all.

Two filters narrow together: active **and** video. Two values inside one filter widen: video **or** carousel.

If nothing matches, the page says "Ningún creativo cumple estos filtros" and offers to remove the last filter applied.

## 4. Grouping

"Agrupar" decides what one card stands for. The default is a creative.

| Grouping | One card is |
| --- | --- |
| Creativo | One picture, video or carousel, with all the ads that use it. |
| Anuncio | One ad. |
| Copy | One ad text, with all the creatives that use it. |
| Titular | One headline. |
| Landing | One destination page. |
| Semana de lanzamiento | Everything launched in one week. |
| Campaña | One campaign. |
| Conjunto | One ad set. |
| Formato | One format. |

A card that stands for a group shows the thumbnail of the group's top-spending creative, the group's name and "N creativos".

Some spend has no single value in a grouping. An ad that rotates five headlines has no one headline. That spend is not thrown away: a line under the cards says "Hay $X de inversión sin un titular único."

## 5. The numbers on a card

Under the header of the content card sit the chosen numbers, as chips. Each chip has a menu: change the metric, move it left or right, remove it.

"+ Métrica" opens the full picker. It has a search and five groups: spend and delivery, video, clicks, conversion, and estimated profit. The chosen ones are numbered and can be reordered.

The order matters, because each view reads from the top of the list:

| View | Shows |
| --- | --- |
| Galería | Up to 4 numbers per card |
| Totales | The first 2 |
| Diario | The first |

Next to the chips is the order (which number sorts the cards, and in which direction) and the switch between the three views.

## 6. The three views

**Galería.** Cards, 8 per page, with an option of 12. A card has the thumbnail, a badge with the format, the name, one row per chosen number and a footer with the verdict and the number of sales. Hovering a video plays it inside the card. A creative with no thumbnail shows a placeholder that says so. Clicking a card does nothing in this release.

**Totales.** A bar chart. Each group of bars is one creative, and each bar one of the first two numbers. Under each group sits the creative's thumbnail with a border in its colour.

**Diario.** A line chart, one line per creative, day by day, for the first number.

Below both charts is a table of the same creatives. A ticked row is a series in the chart, and the tick is filled with that row's colour. Totales starts with the first 10 rows ticked and Diario with the first 5. At most 10 can be ticked: an eleventh is refused with a short message. The table has its own search, its own pages of 10, and sorts by clicking a column header. That order is the report's order, so it also applies to the gallery.

## 7. The verdict

The verdict compares what the ad platform says a creative returned with what the store needs to break even.

| Verdict | Meaning |
| --- | --- |
| Rentable | Returns more than break-even. |
| En el límite | Within 5% of break-even, either side. |
| No rentable | Returns less. |
| – | The store has no cost data to work out a break-even. |

Its tooltip says "Según los datos de Meta". It is the platform's own count of sales, which is usually more generous than the store's.

## 8. Saving

- **On a ready-made report**, "Guardar" asks for a name and creates a new report with the page as it is. The ready-made report is never changed.
- **On a saved report**, a change enables "Guardar", which saves over it for everyone. With no change, it is disabled.
- **"Guardar como reporte nuevo"**, in the "···" menu, makes a copy under a new name.
- **"Nuevo reporte"** opens an untitled report with the default setup. Its first "Guardar" asks for a name.
- **"Renombrar"** and **"Eliminar reporte"** are in the "···" menu of a saved report. Deleting asks for confirmation and says it is removed for the whole organization.

A report saved while a preset range is chosen, such as "Últimos 14 días", keeps moving: next week it shows that week's 14 days. A report saved with hand-picked dates keeps those dates.

"Compartir" and "Exportar CSV" are in the menu and say "Disponible pronto".

## 9. On a phone

The gallery shows one card per row. The filter list, the grouping list, the metric picker and the report switcher open as sheets from the bottom. "Guardar" and "Nuevo reporte" move into the "···" menu. In the chart views the chart scrolls sideways inside its box and the table keeps its first column fixed.

## What a user will notice is missing

- No detail screen for a creative.
- No comparison with the previous period.
- One ad platform only.
- Many creatives without a thumbnail, while the media library fills up.
- No saving at all until the database migration is run. Until then the save buttons are disabled and say "Los reportes guardados todavía no están disponibles."

The reasons are in [Decisions and open questions](./06-decisions-and-open-questions.md).

## Terms

- **Thumbstop**: of the people who saw a video, the share that watched at least 3 seconds.
- **Hold rate**: of the people who watched 3 seconds, the share that watched to the end or to 15 seconds.
- **ROAS**: revenue the platform attributes to the ads, divided by what they cost.
- **Break-even**: the ROAS at which a creative neither earns nor loses, given the store's costs.
- **Remainder**: spend that has no single value in the chosen grouping.
