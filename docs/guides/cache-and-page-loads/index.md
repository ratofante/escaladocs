---
title: "Cache and page loads"
sidebar_label: Overview
sidebar_position: 0
description: "How the pages of the app reach the screen on the performance-staging branch: the server answers with the structure at once, skeletons cover what is missing, and the numbers come from the browser's cache or from API routes that read a server cache, without waiting for ClickHouse."
---

# Cache and page loads

How the pages of the app reach the screen on the performance-staging branch: the server answers with the structure at once, skeletons cover what is missing, and the numbers come from the browser's cache or from API routes that read a server cache, without waiting for ClickHouse.

Branch: `performance-staging`

:::tip[How to read it]

Read chapter 1 first: it introduces every mechanism the other chapters lean on. Then jump to the page you care about; each page chapter stands on its own and says where that page departs from the general pattern. Chapters 9 and 10 are for operating and measuring the whole thing.

Every chapter opens with a plain-words walk-through and only then shows the code. Every snippet is copied from the repo with its file and line range.

:::

## Chapters

1. [The big picture](./01-the-big-picture.md): The problem (a first render that waits for ClickHouse), the idea (the server never ships numbers), and the six places a number can live, from ClickHouse to the phone's disk.
2. [Dashboard](./02-dashboard.md): The daily snapshot, ranges the browser sums by itself, ranges the server serves whole, the totals that cannot be summed, and the 'Updating' pill.
3. [Ads](./03-ads.md): First tenant of the per-day cache: one key per platform and grain, names cached apart, campaigns opened on demand, and other platforms preloaded while you look at one.
4. [Products](./04-products.md): Three grains, two currencies stored in the same day, days or days-per-range depending on size, and customer counts that need their own range entry.
5. [LTV](./05-ltv.md): Cohort grids cannot be summed by day, so LTV uses the range cache: one entry per org, currency and day holding the four windows.
6. [Inventory](./06-inventory.md): Stock, sales days and issues behind the cache, why the page keeps a loading.tsx, and what the browser sums versus what the server answers whole.
7. [Customer Journey](./07-customer-journey.md): Journey days stored per day but built into blocks on the server, session presets stored ahead of the click, the lost-sessions block, and the UTM alert shared with Products.
8. [Monitoring](./08-monitoring.md): Deliveries, counts and quality as per-day keys, no loading.tsx, long ranges through the analytics route, and the Klaviyo view that stays uncached.
9. [Warm-up](./09-warm-up.md): How the server fills the caches of an org before anyone asks (the tick, its lease and budget) and how each tab copies what the server has while idle.
10. [Measuring it](./10-measuring.md): Navigation marks in page_timing, the X-Cache header and its log line, log_comment in ClickHouse, the public API, and what the branch deliberately did not change.

---

<small>Source of truth: `docs/features/client-cache/README.md` and the code on `performance-staging`. Written with `/write-guide`; files in `docs/guides/cache-and-page-loads/`.</small>
