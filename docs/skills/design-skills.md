---
title: "Design skills"
sidebar_label: "Design skills"
sidebar_position: 3
description: "The four design skills (/escalafy-ux, /escalafy-design, /escalafy-figma-sync, /ds-page-migration): how to get them on your machine, the order to run them in, and what you decide at each stop."
---

# Design skills

*After this page you can install the four design skills, pick the right one for the job in front of you, and know where each one stops and waits for you.*

<small>~5 min · Built on: `escalafy-skills/skills/design/*/SKILL.md`, `escalafy-skills/README.md`, `escalafy-app/DESIGN.md`</small>

:::tip[In simple terms]

Four skills cover the road from "this screen feels clunky" to "the new screen is in the app". They always run in the same order: measure, design, sync, code.

First, one skill measures an existing flow on your local app. It counts clicks, waits and elements, and comes back with ranked findings. It never proposes code. Second, another skill designs the new screen or component in the team's Figma file. It reads the house rules, asks you a few questions once, shows a short plan you can correct, and then draws several iterations beside the original. Third, when a design is approved, a sync skill makes the Figma component kit and the code's design tokens agree again. It only reports until someone approves each change. Fourth, a migration skill takes the approved frame and rebuilds the page in code with the existing design system components only. It starts with a written study and a list of questions, and builds only after you answer them.

None of them commits, pushes or opens tickets. They live in a separate shared repository, and your machine links to them, so pulling that repository updates them.

:::

## 1. Getting them on your machine

The skills are written in the team's skills repository, not in the app. You link them into your personal Claude Code folder once, and they show up in every session you open from `escalafy-app`.

In the code, the repository's Windows installer creates a directory junction per skill. A junction is a folder link that needs no admin rights. The installer links all 21 team skills. For design work only, link the four design folders by hand with the same command:

```ps1 title="escalafy-skills/install.ps1 · L56"
  New-Item -ItemType Junction -Path $dst -Target $src | Out-Null
```

Run it once for each of `escalafy-ux`, `escalafy-design`, `escalafy-figma-sync` and `ds-page-migration`, with `$src` set to `escalafy-skills\skills\design\<name>` and `$dst` set to `%USERPROFILE%\.claude\skills\<name>`. Then `git pull` in `escalafy-skills` is the whole update.

They also expect three things that are not in that repository:

- **`hallmark`** in `~/.claude/skills/`: its `sloplint.mjs` lints designs and the code built from them.
- **`fluid-functionalism`** in `~/.claude/skills/`: its `craft.md` holds the motion rules, and its `audit.mjs` measures transitions. The official install is `npx skills add mickadesign/fluid-functionalism -g -y` (fluidfunctionalism.com/skill). Check afterwards that the folder landed in `~/.claude/skills/fluid-functionalism`.
- **The Figma MCP**, with edit access to the "Escalafy Design Internal" file.

:::info[Why this way]

Linking beats copying because a copy drifts: everyone ends up running a private version of the recipe. The links go in your personal folder rather than in `escalafy-app/.claude/skills/` because the skills call their own scripts and references by the absolute path `~/.claude/skills/<name>/…`. Linked under the repo, those paths would not resolve.

:::

:::warning[Gotcha]

To change a skill, edit it in `escalafy-skills`, never through the link from inside `escalafy-app`. The README calls that repository "their home". Also, the skills name **Mateo** as the person who answers and approves. When you run one, the questions come to you, but the sync skill's text still requires Mateo's OK before anything is written to the UI Kit.

:::

## 2. Measure a flow: `/escalafy-ux`

Use it before redesigning something that already exists. It walks the flow on your local app the way a first-time user would, counts every action, has a separate agent describe each screen without seeing the code, and ranks the findings. Each finding needs a number or a quote as evidence, and the finding is dropped if it has none.

In the code, it writes one file per step into a dated folder, and it treats every click as real:

```md title="escalafy-skills/skills/design/escalafy-ux/SKILL.md · L21–L23"
- The dev server running (`localhost:3000`) and Mateo's own organization. Never a customer's.
  **The dev server uses the production database**: every click is real, so the "stop before any
  data-changing submit" rule below is absolute.
```

**Your part.** Name at most five tasks the person comes to do. At the end you get `docs/ux/<flow>/<date>/07-findings.md`, which closes with a brief ready for `/escalafy-design`.

## 3. Design it in Figma: `/escalafy-design`

This is the skill for a new screen, state or component. It reads `DESIGN.md`, the dated rules in `references/guidelines.md` and the reference library before drawing anything. It uses only kit components and variables, lints what it built, and has a second agent review it with fresh eyes.

In the code, the run's decisions are printed once, as a plan block. That block is your one chance to redirect it before it draws:

```md title="escalafy-skills/skills/design/escalafy-design/SKILL.md · L86–L96"
**Escalafy design — <screen>**

- **Job** · <verb + object> · first thing seen: <x>
- **Content** · real: <fields> · placeholder: <none | which and why>
- **Map** · <region> → <ds component / variant / size> (UI Kit <node>) · … one line per region
- **States** · rest · hover (penultimate row) · loading · empty · error · no access · mobile <yes/no>
- **Gaps** · <region with no kit fit> → proposed new variant <name> (question) | none
- **References** · <file> (borrow … / leave …) · internal gold: <node>
- **Iterations** · <N>, varied on <axis>: A <idea> · B <idea> · C <idea>
- **Medium** · Figma | local prototype | Stageshow
- **Where** · beside <node> on <page>, named "<round>.<n> iteración A/B/C" (or the prototype route)
```

**Your part.** Answer its questions (at most four, asked once), correct the plan block, then give feedback as Figma annotations in the category "Para Claude". It works those like an inbox. When motion or behaviour is the point and a static frame cannot show it, ask for the **local prototype** medium: a dev-only page under `app/(app)/prototypes/<name>/` built with `components/ds`.

:::info[Why this way]

The skill decides content, the component map and references before the first node, instead of drawing first and fixing later. A bad structure costs one line in the plan block. Drawn into three iterations, it costs a full round.

:::

## 4. Keep Figma and code in step: `/escalafy-figma-sync`

The design system exists twice: as variables and components in the Figma kit, and as tokens and variants in code. This skill measures the difference between them the same way every time. Its default mode, `audit`, only reads. The other modes are `apply` (close the gaps approved in an audit), `promote <node>` (turn an approved iteration into a kit component named "V2") and `code-connect`.

```md title="escalafy-skills/skills/design/escalafy-figma-sync/SKILL.md · L60–L61"
4. Ask which changes to apply. Nothing is written to Figma before Mateo approves them
   (`sync-rules.md` § Which side wins: the code wins and a person approves every Figma edit).
```

**Your part.** Run `audit` after you add a token or a variant in code, read the drift report, and choose which batches to apply.

## 5. Take an approved frame to code: `/ds-page-migration`

This is the only one of the four that writes product code, and it starts only when the design is fully approved. Give it the route and the Figma node. Phase 1 runs in a background agent: it studies the code and the frame, and writes `docs/features/<page>-redesign/requirements.md` with a component map and numbered questions. Phase 2 starts after your answers.

```md title="escalafy-skills/skills/design/ds-page-migration/SKILL.md · L56–L59"
- ONLY ds components + their existing variants + tokens. No inline `style`, no hardcoded
  colors (the legacy-tokens test enforces `colors.css`), no className overrides that fight a
  component. Missing variant → add it to the ds component (header comment + ds test), never a
  page-local copy.
```

**Your part.** Answer the questions, then say "phase 2" in the same conversation. Review the result like a PR, and run the dev server to compare it with the frame.

## Follow a request

1. **You** · `/escalafy-ux` on the flow that bothers you. You get ranked findings and a design brief.
2. **You** · `/escalafy-design` with that brief, or with "a new video player component" and the Figma node to sit beside.
3. **Skill** · reads the rules, asks up to four questions, prints the plan block. You correct the map.
4. **Skill** · draws iterations A/B/C beside the original, lints them, reviews them, and hands off node links.
5. **You** · leave "Para Claude" annotations until one iteration is approved.
6. **You** · `/escalafy-figma-sync promote <node>` to make it a kit "V2", then `audit` for the tokens.
7. **You** · `/ds-page-migration <route> — Figma node <id>, phase 1`, answer the questions, then "phase 2".

## Where to look

| Role | File |
| --- | --- |
| Where the skills live, their prerequisites | `escalafy-skills/README.md` |
| Junction installer (all team skills) | `escalafy-skills/install.ps1` |
| Measure a flow | `escalafy-skills/skills/design/escalafy-ux/SKILL.md` |
| Design in Figma | `escalafy-skills/skills/design/escalafy-design/SKILL.md` |
| House design rules, dated | `escalafy-skills/skills/design/escalafy-design/references/guidelines.md` |
| Figma ↔ code sync | `escalafy-skills/skills/design/escalafy-figma-sync/SKILL.md` |
| Kit component ↔ `components/ds` file map | `escalafy-skills/skills/design/escalafy-figma-sync/references/ui-kit-map.md` |
| Frame to code | `escalafy-skills/skills/design/ds-page-migration/SKILL.md` |
| The locked design system in one page | `escalafy-app/DESIGN.md` |

## Terms

- **junction**: a Windows folder link; `~/.claude/skills/<name>` points at the folder in `escalafy-skills`.
- **plan block**: the one printed summary of a design run, and your window to redirect it.
- **iteration**: one design variant, drawn beside the original and never on top of it.
- **gap**: a region no kit component fits; the skills propose a new variant as a question, never a one-off.
- **drift**: a difference between the Figma kit and the code tokens or variants.
- **V2**: an approved iteration promoted into the UI Kit beside the old component.
- **phase 1 / phase 2**: the migration's study (a requirements doc, no code) and build (code after your answers).
