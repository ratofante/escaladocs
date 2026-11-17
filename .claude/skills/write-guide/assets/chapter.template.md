---
title: "CHAPTER TITLE"
sidebar_label: "N. CHAPTER TITLE"
sidebar_position: N
description: "The lede, repeated."
---

# CHAPTER TITLE

*Lede: two sentences on what the reader can predict or do after this chapter. No identifiers.*

<small>~N min · Built on: ESC-NNN, docs/features/…/README.md</small>

:::tip[In simple terms]

<!-- The problem and the flow in plain language: what the page needs, where that can be found, what the
code checks and in which order, what changes for the user. No personas, scenes or analogies. Zero code
names, files, tables or tickets. 150–300 words. -->

:::

## 1. MECHANISM NAME

<!-- Plain paragraph: what it is and what it does for the user, before any identifier. -->

In the code, <!-- the names: functions, files, constants, in one paragraph -->.

```ts title="lib/path/to/file.ts · L12–L30"
// verbatim code, trimmed with …
```

:::info[Why this way]

<!-- The decision and the alternative it beat, in two or three sentences. -->

:::

<!-- Repeat for 4–7 mechanisms, in dependency order. -->

:::warning[Gotcha]

<!-- Optional. Only a real trap: a stale doc, a stale code comment, a thing that looks safe and is not. -->

:::

## What is different on this page

<!-- Page chapters only. Where this page departs from the general pattern and why. -->

- **Decision.** One sentence on what and one on why.

## Follow a request

<!-- 5–9 steps for a generic user. -->

1. **Browser** · What happens and which function decides it.
2. **API route** · …

## Where to look

| Role | File |
| --- | --- |
| What this file owns | `lib/path/to/file.ts` |

## Terms

- **term**: One line. (README: "término")
