---
name: write-guide
description: Write or extend a chapter-based guide in this Docusaurus site (docs/guides/<slug>/, one Markdown file per chapter, fixed chapter shape, plain words before code). Use with /write-guide init|chapter|check, or when asked for a guide, handbook, course or chaptered documentation of a feature, branch or subsystem of escalafy-app.
---

# write-guide

A guide is a folder in `docs/guides/<slug>/`:

```
_category_.json       { "label": "<Title>", "position": N, "collapsed": false }
index.md              overview: what the guide explains, how to read it, the chapter list with one line each
01-<chapter>.md …     one file per chapter; the number orders the sidebar and is stripped from the URL
```

The code the guide describes lives in `../escalafy-app` (read it there; never edit it from here). Chapter 1 of
`docs/guides/cache-and-page-loads/` is the approved blueprint: match its tone and shape before inventing.

`$ARGUMENTS` = `<mode> <guide-slug> [chapter-file]`. With no mode, read the request and pick one.

## init `<slug>` — create a guide

1. Create the folder with `_category_.json` and `index.md` (front matter: `title`, `sidebar_label: Overview`,
   `sidebar_position: 0`, `description`). Decide the full chapter list now with a one-line summary each, so
   the overview shows what is coming and chapters can be written in parallel: one presentation chapter first
   (the problem, the idea, the vocabulary), then one chapter per page/area where decisions differ, then the
   cross-cutting chapters (operations, measurement). Mark unwritten ones "(soon)" in the list.
2. Add the guide to the list in `docs/index.md`.
3. `npm run build` must pass (`onBrokenLinks: 'throw'` catches a bad link).

## chapter `<slug>` `<NN-file.md>` — write one chapter

Research first, write second, verify third. Budget: 1,200–2,000 words of prose (tables, trace and terms
excluded), 4–8 snippets of ≤ 25 lines.

1. **Read the sources** the brief names (the feature README section in `escalafy-app/docs/features/…`, the
   ticket, design docs) and then the code they cite. The code is the truth; a doc that disagrees with the
   code is wrong and the chapter says so in a `:::warning[Gotcha]`.
2. **Copy** `.claude/skills/write-guide/assets/chapter.template.md` to the chapter file and fill it in the
   template's order (see "Chapter contract"). Delete the `<!-- … -->` instructions as you go.
3. **Verify every snippet**: `grep -n` the first and last line of each snippet in its file in this session,
   and put the real line range in the fence title: ```` ```ts title="lib/path/file.ts · L12–L30" ````.
   A snippet is copied, never paraphrased; trim with `…`. The language tag follows the extension.
4. Run `check` and fix what it reports.

### Chapter contract

The reader is a developer who owns the feature but reads on a phone, without the code open. The shape is
fixed so chapters feel the same and never run long:

| Section | Rule |
| --- | --- |
| Lede (italic, after the H1) | Two sentences: what the reader can predict or do after the chapter. No identifiers. |
| `:::tip[In simple terms]` | The problem and the flow in plain language, as a colleague would explain it at a whiteboard: what the page needs, where that can be found, what the code checks and in which order, what changes for the user. No personas, no scenes, no analogies, no ELI5. **Zero** code names, files, tables or tickets. 150–300 words. |
| The mechanisms (`## N. …`) | 4–7 of them, in dependency order: **never use a name before the heading that introduces it.** Each = a plain paragraph (what it is, what it does for the user) → an "In the code, …" paragraph with the names → one verbatim snippet with path + lines → `:::info[Why this way]` (the decision and the alternative it beat). |
| `:::warning[Gotcha]` | Optional, only for a real trap (a stale doc, a stale code comment, a cookie `after()` cannot read). |
| What is different on this page | Page chapters only: where this page departs from the guide's general pattern and why. Bullets. |
| Follow a request | One timeline of 5–9 numbered steps, `**Who** · what happens and which function decides`. A generic user, no persona. |
| Where to look | Role → file table. Every file named in the chapter appears once. |
| Terms | Every term the chapter coined, `- **term**: one line`. If the feature README coins a Spanish term, quote it once: `(README: "siembra")`. |

### Writing rules

- **English.** Technical terms are the code's own names and are never translated.
- **Plain before technical, in every section.** Introduce a mechanism in plain words before naming it.
  Dense lists of names with no context are the failure mode to avoid.
- **Concrete cases, no fiction.** "The user picks Last 30 days" is fine; invented people, dates and scenes
  are not.
- **Decisions carry their why.** Every "Why this way" names the alternative that lost.
- **Cut what does not change a prediction.** No ticket history, no praise, no restating the snippet.
- **Numbers only when they decide something** (a budget, a cap, a lease), with their constant.
- One idea per sentence. Short sentences. No em-dashes.
- Markdown is CommonMark here (`markdown.format: 'detect'`): no JSX, no `{expressions}`; `<small>` and
  other inline HTML are fine.

## check `<slug>` — verify

```
npm run build
```

Then, for each chapter: count fences (two per snippet), confirm each fence title's path exists under
`../escalafy-app`, and confirm the five fixed sections are present. No script does this yet; do it by hand
or with a short node one-liner.

## Writing chapters in parallel with agents

One agent per chapter, all in one message. Each brief contains, and only contains: the chapter file; the
sources (README section line ranges, tickets, entry files in `../escalafy-app`); the other chapters in one
line each so the agent links (`./NN-….md`) instead of re-explaining; and the instruction to read this
SKILL.md and chapter 1 of the cache guide first, write only its file, and report file, word count,
snippets with path and range, and anything in the sources that disagreed with the code.
