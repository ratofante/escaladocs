---
title: "Creativos, phase 1"
sidebar_label: Overview
sidebar_position: 0
description: "What was built for the first release of Creativos, the creative analytics section of the app: the report of creatives with its three views, filters, grouping, the gallery of ready-made reports and saved reports, with the decisions behind each and what is still open."
---

# Creativos, phase 1

What was built for the first release of Creativos, the creative analytics section of the app: the report of creatives with its three views, filters, grouping, the gallery of ready-made reports and saved reports, with the decisions behind each and what is still open.

Branch: `feature/esc-799-creativos-ui-fase-1-reporte-de-creativos-con` · Ticket: ESC-799 · Written 2026-11-20

:::tip[How to read it]

Read chapter 1 first: it names every piece the other chapters lean on. Chapter 2 is the page from the user's side and has no code; read it if you have not used the page yet.

Chapters 3, 4 and 5 are the mechanisms, from the database up to the screen. Each stands on its own.

Chapter 6 is for anyone about to change a behaviour: it says whether a person decided it or the build took it as a default. Chapter 7 is the checklist for the staging preview, including the one database migration.

Chapter 8 is the one to read with the page open on one screen and the editor on another. It follows the page in the order you click and names the file, the request and the server code behind each part.

Every mechanism opens in plain words and only then shows the code. Every snippet is copied from the branch with its file and line range.

:::

## Where it stands

| | |
| --- | --- |
| Built | Nine changes, one commit each, all pushed to the branch. |
| Automated checks | Passing: the feature's tests, types, the hardcoded-organization check, formatting. |
| Seen in a browser with real data | **Not yet.** The first look is on the staging preview (chapter 7). |
| Database migration | **Written, not run.** Until it runs, saving reports is switched off and the rest works. |
| Production | Not shipped. It ships through `main`, on someone else's timing. |

## Chapters

1. [The big picture](./01-the-big-picture.md): What a creative is, the two screens, the path of a number from the ad platform to a card, and the nine changes of the build.
2. [Using the page](./02-using-the-page.md): The gallery of reports, the report's header, filters, grouping, the choice of numbers, the three views, the verdict and saving, as a user meets them.
3. [The report data](./03-the-report-data.md): One row per creative, money in one currency, grouping, the remainder and coverage, the verdict and break-even, what the Limited role never receives, and the three data routes.
4. [The report page](./04-the-report-page.md): One state kept in the address, the request built from it, the card and its video, the filter and grouping controls, the metric list, and the two chart views with their table.
5. [Reports](./05-reports.md): A report as a configuration, the 12 ready-made ones in code, what an address with a report means, "Modificado", saved reports in the database, favourites and recents, and the page before the migration.
6. [Decisions and open questions](./06-decisions-and-open-questions.md): Which behaviours a person decided, which the build took as defaults and what reversing each takes, and what is waiting for an answer.
7. [Trying it on staging](./07-trying-it-on-staging.md): The checks before the migration, the migration with its check and undo, and the checks after it.
8. [A tour with the code open](./08-a-tour-with-the-code-open.md): A walk through the page in the order you click, with the file that draws each part, the request it sends and the server file that answers.

---

<small>Source of truth: `docs/features/creatives/README.md` and the code on the branch. Files in `docs/guides/creatives-phase-1/`.</small>
