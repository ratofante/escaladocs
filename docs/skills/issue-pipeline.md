---
title: "Issue pipeline"
sidebar_label: "Issue pipeline"
sidebar_position: 2
description: "The three commands that take a Linear issue from research to archived OpenSpec changes: /issue-research, /issue-plan and /issue-build, what each produces, what Rodrigo does at each gate, and the decisions baked into them."
---

# Issue pipeline

*After this page you can run a Linear issue through the three commands, know what to expect from each one, and know what is yours to decide at each stop.*

<small>~8 min · Built on: `escalafy-app/.claude/skills/issue-research`, `issue-plan`, `issue-build`, `.claude/agents/change-implementer.md`</small>

:::tip[In simple terms]

Working on an issue has a rhythm: understand it, decide how to solve it, cut the solution into small pieces, build the pieces, check them, close. The pipeline keeps that rhythm and puts you at the three points where only you can decide.

First, one command reads the issue and the code and comes back with a list of decisions, each with a recommendation. You settle them one at a time. Second, another command cuts the work into small OpenSpec changes and writes a proposal for each. You review them. Third, a last command hands each change to an implementer running on Opus, answers their questions from everything learned so far, and tells you when a change is at a first working version, together with what remains to verify and who can do it. You pick what to run. When you are done, the same command summarises and archives.

:::

## 1. Research: `/issue-research ESC-nnn`

Claude reads the issue and its comments in Linear, the feature's README and glossary under `docs/features/`, the project memory, and the code where each requested behaviour lives today. It writes one file, `docs/personal/issues/ESC-nnn/research.md`, and then opens the discussion.

The core of the file is the decision table. Each row has an id (`D1`, `D2`, …), a kind, a question, options, a recommendation with its reason, and a status.

| Kind | Examples |
| --- | --- |
| product | What the user sees and when. Who is gated by plan or permission. Copy and i18n. The edge case. |
| architecture | Postgres or ClickHouse. Cache behaviour. Server component, API route or server action. Migration shape. How it rolls out on staging. |

**Your part.** Claude presents one decision per message, with the mechanism explained before its name. You confirm or change each one. The file is updated as you go; the chat is not the record. The step ends when every row is `settled`.

:::info[Why this way]

Rodrigo usually follows the recommendation, so the recommendation has to carry its reason. One decision per message was chosen over a full table dump because the discussion stays followable, and because changing an earlier row is cheap while it is still the only one on screen.

:::

## 2. Plan: `/issue-plan ESC-nnn`

Claude refuses to start while a row is open. Then it slices the work into the smallest changes that each leave the app working when deployed alone on staging. Cuts are vertical: one behaviour from migration to UI is one change. A migration goes in the change that first reads it. A shared piece becomes the first change of the series.

**Your part.** Claude shows the slicing as a short ordered list and waits for your go before writing anything. Then it runs `/opsx:propose` once per change, in dependency order, feeding each one the settled decisions it implements. The decisions land in each change's `design.md` under Decisions, in the four-question form the project's OpenSpec config enforces.

The step ends with `docs/personal/issues/ESC-nnn/plan.md`:

```md title=".claude/skills/issue-plan/SKILL.md · L65–L68"
| # | Change | Depends on | Decisions | Files |
| - | ------ | ---------- | --------- | ----- |
| 1 | esc-nnn-foo | — | D1, D3 | lib/…, app/… |
| 2 | esc-nnn-bar | 1 | D2 | … |
```

The Files column is not decoration. It is what the next step uses to decide which changes can run at the same time.

## 3. Build: `/issue-build ESC-nnn`

The session that runs this command becomes the orchestrator. It reads the research note, the plan and every change's artifacts, so it holds the whole context of the issue.

**Schedule.** Everything runs in one working tree and Claude never commits, so two agents editing the same file at once destroy each other's work. The orchestrator groups changes into waves:

```md title=".claude/skills/issue-build/SKILL.md · L28–L30"
- Two changes can run **in parallel** when neither depends on the other and their file lists
  are disjoint. Shared files that both only read (a schema, a type) do not count as overlap.
- Everything else runs **sequentially**, in dependency order.
```

**Implementers.** For each change in a wave the orchestrator starts a `change-implementer` agent on Opus with a brief: the change's artifacts, the decisions it carries, the files it owns, the files it must not touch, the repo rules (no commits, no migrations, `npx tsc --noEmit` instead of a build, tests only where CLAUDE.md allows one), and the report format.

**Questions.** An implementer ends in `v0` or `blocked`. The orchestrator answers blocked ones itself from the research note, the design and the code, sends the answer to the same agent so it continues, and records the decision in that change's `design.md`. It escalates to you only when the answer would change a settled `D…` row or something a user would see.

**Your part.** When a change reaches v0 you get a short report, always in this order: decisions taken or changed, deviations from the design, blockers, and the verifications that remain. The verifications come from the implementer's report:

```md title=".claude/skills/issue-build/brief.template.md · L55–L59"
| What | Claude can run it? | Why |
| ---- | ------------------ | --- |
| npm run test:area <area> | yes | … |
| migration docs/migrations/NNN_x.sql on the shared DB | no, Rodrigo | writes production data |
| env var X on Vercel | no, Rodrigo | secret |
```

Nothing in that table runs by itself. You say which rows Claude runs from the session and which ones you take: migrations against the shared database, secrets, Vercel or Clerk or Stripe settings, a staging visit.

:::info[Why this way]

The orchestrator decides the implementers' questions because it is the only party with all the context, and because waiting on Rodrigo for every question would turn a parallel build into a serial chat. Verifications are listed rather than run because several of them write production data from staging, and that call stays with the person.

:::

## 4. Close: `/issue-build ESC-nnn close`

Run after your verifications. For each change, Claude fills the validation subheadings at the end of `design.md` with what you reported, leaving `*Pending.*` with a reason when something waits for the production ship, and runs `/opsx:archive`, which syncs the delta specs into the main specs and moves the change to the archive.

It then writes `docs/personal/issues/ESC-nnn/summary.md` and pastes it in chat: the changes on staging and what each does, every decision made along the way with its reason, the migrations run and settings changed, and what remains for the production deployer. It is written for the team, so it can go to Linear or Slack as it is.

## Follow an issue

1. **You** · `/issue-research ESC-812`. Claude reads Linear, the feature docs and the code, writes `research.md`, presents D1.
2. **You** · settle D1 to D4 over four messages; one recommendation changed, the file records your reason.
3. **You** · `/issue-plan ESC-812`. Claude proposes three changes, you approve, it writes three proposals and `plan.md`.
4. **You** · read the three proposals in `openspec/changes/`, fix a task by hand.
5. **You** · `/issue-build ESC-812`. Changes 1 and 2 share no files: wave 1 runs both on Opus, wave 2 runs change 3.
6. **Orchestrator** · change 2 reports `blocked` on a copy question; the orchestrator answers from D3 and records it in `design.md`.
7. **Orchestrator** · change 1 reaches v0; you get the four-part report and pick which tests Claude runs now.
8. **You** · run the migration on the shared database, set the secret on Vercel, visit staging.
9. **You** · `/issue-build ESC-812 close`. Three changes archived, `summary.md` pasted.

## When something goes wrong

- **A row is still open and you want to plan anyway.** `/issue-plan` stops and lists the open rows. Settle them in `research.md`, or run `/issue-research` again: it resumes from the file.
- **A session dies mid-build.** Run `/issue-build` again. It reads `openspec status` for each change and resumes half-done changes instead of restarting them.
- **Two implementers touched the same file.** The plan's file lists were wrong. Fix `plan.md`, revert the collision by hand, run the build again sequentially.
- **`/opsx:propose` did not fire from inside the skill.** Run it yourself with the material the skill prints; see the gotcha in [How a skill works](./how-a-skill-works.md).

## Where to look

| Role | File |
| --- | --- |
| Research recipe | `escalafy-app/.claude/skills/issue-research/SKILL.md` |
| Research note shape | `escalafy-app/.claude/skills/issue-research/research.template.md` |
| Slicing and proposals | `escalafy-app/.claude/skills/issue-plan/SKILL.md` |
| Orchestrator, both modes | `escalafy-app/.claude/skills/issue-build/SKILL.md` |
| Implementer brief and report format | `escalafy-app/.claude/skills/issue-build/brief.template.md` |
| Implementer agent, model | `escalafy-app/.claude/agents/change-implementer.md` |
| Per-issue state | `escalafy-app/docs/personal/issues/ESC-nnn/` (gitignored) |
| Decision record once changes exist | `escalafy-app/openspec/changes/<change>/design.md` |

## Terms

- **gate**: a stop where only you decide; the pipeline has three, at the end of each command.
- **decision table**: the `D…` rows in `research.md`, split into product and architecture.
- **slicing**: the cut of an issue into OpenSpec changes, each deployable alone on staging.
- **orchestrator**: the session running `/issue-build`; holds the full context and decides implementers' questions.
- **implementer**: a `change-implementer` agent on Opus building exactly one change.
- **wave**: the set of changes the orchestrator runs at the same time.
- **v0**: a change with its tasks done, type-checked, not yet verified by you.
- **verification**: a remaining check with a "Claude can run it?" column; you decide who runs it.
