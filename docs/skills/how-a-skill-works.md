---
title: "How a skill works"
sidebar_label: "How a skill works"
sidebar_position: 1
description: "What a Claude Code skill is made of, why the first lines cost more than the rest, how to decide between one skill and several, how state survives between them, and how a skill runs agents on a chosen model."
---

# How a skill works

*After this page you can read any `SKILL.md` and say which part Claude always sees and which part it sees only when the skill runs, decide whether a workflow should be one skill or several, and know where a skill keeps what it has to remember between sessions.*

<small>~9 min · Built on: the issue pipeline skills in `escalafy-app/.claude/skills/`, the Claude Code skills and subagents docs</small>

:::tip[In simple terms]

Claude Code keeps a list of every skill it could use. For each one it holds only a name and a short description, so the list stays small. When you type a skill's name, Claude opens its file and follows the instructions inside. Those instructions can point at other files in the same folder, which Claude opens only when told to.

This means a skill has two costs. The description is paid in every conversation, whether the skill is used or not. The body is paid only when it runs. A skill that is only ever started by a person can be marked so that Claude never considers it on its own, and then its description costs nothing.

A workflow with several moments where a person has to decide is usually several skills, one per stretch between decisions. Each stretch loads only its own instructions, and the file one skill writes is what the next one reads. When a skill needs helpers, it starts agents, each with its own instructions and, when it matters, its own model.

:::

## 1. Anatomy

A skill is a folder with a `SKILL.md`. The file opens with a block of key-value lines between two `---` lines, called the front matter, and continues with Markdown. Sibling files in the folder are optional: templates to fill, reference to read, scripts to run.

In the code, the front matter of the research skill looks like this:

```yaml title=".claude/skills/issue-research/SKILL.md · L1–L6"
---
name: issue-research
description: Research a Linear issue and write its research note with the product and architecture decisions Rodrigo has to take. Step 1 of the issue pipeline; use with /issue-research ESC-nnn.
argument-hint: "ESC-nnn"
disable-model-invocation: true
---
```

Fields that matter here:

| Field | What it does |
| --- | --- |
| `name` | The command name after `/`. Defaults to the folder name. |
| `description` | What the skill does and when to use it. The only text Claude sees before deciding. |
| `argument-hint` | Shown in the command menu while typing, such as `ESC-nnn`. |
| `disable-model-invocation` | `true` means only a person can start it. Claude never picks it on its own. |
| `allowed-tools` | Tools the skill may use without asking, such as `Bash(openspec:*)`. |
| `context: fork`, `agent`, `model` | Run the body in a subagent instead of the main conversation. Not used in our skills yet. |

:::info[Why this way]

Claude Code loads skills in three levels: name and description always, the body when the skill fires, sibling files when the body says so. The alternative, one long file with everything inline, makes every skill pay for every other skill's detail. Keeping `SKILL.md` short and pushing templates to siblings is how the list of skills can grow without slowing every conversation.

:::

## 2. The pointer and the recipe

The description is a pointer: it names material that is not in context and says when to reach for it. The body is the recipe. The two are written differently. A pointer front-loads the trigger ("Research a Linear issue…") and lists the distinct cases that should fire it. A recipe explains why each step matters, because the model reasons better from a reason than from a capitalised rule.

When a skill is only started by hand, set `disable-model-invocation: true`. The description then becomes a one-line summary for the person, the trigger list goes away, and the skill costs no context in sessions that do not use it. The price is that you have to remember the name. The catalog on the overview page is where that memory lives.

## 3. Arguments

What you type after the command reaches the body as `$ARGUMENTS`. The research skill reads it as the issue id. Positional pieces are `$0`, `$1`, and so on. `${CLAUDE_SKILL_DIR}` is the skill's own folder, which is how a body points at its templates without hardcoding a path.

## 4. One skill or several

The deciding question is where the person has to speak before work continues. Call those moments gates. The issue pipeline has three: after the decisions are discussed, after the proposals are written, when a change reaches v0.

A gate is a context boundary. If one skill holds every step, Claude reads "dispatch the implementers" while it is still researching, and the later steps pull it to finish the current one early. Splitting at the gates keeps the later steps out of view until the person opens them. Each skill ends by naming the next command, so the sequence is still one path.

:::info[Why this way]

The alternative was one skill with phases and explicit "stop here" lines. It was rejected because a stop line is an instruction the model can skip under pull from the steps after it, while a separate skill makes the stop structural: the next body does not exist in context until the person types its name.

:::

## 5. State between skills

Three skills can run on three days in three sessions, so nothing in the chat survives between them. Whatever one skill decides goes in a file the next one reads. The pipeline uses `docs/personal/issues/ESC-nnn/` in `escalafy-app`, a gitignored folder: `research.md` carries the decision table from research to planning, `plan.md` carries the slicing and file lists from planning to building, and `summary.md` is written at the close.

Once the OpenSpec changes exist, the decisions move into them. Each change's `design.md` has a Decisions section that the project's OpenSpec rules force into a fixed four-question form, and that section is what the implementers read. The research note stays as history.

## 6. Agents on a chosen model

A skill can start agents to do work in parallel or on a different model. The build skill starts one agent per OpenSpec change on Opus. An agent is defined by a Markdown file in `.claude/agents/`, with the same front matter idea:

```yaml title=".claude/agents/change-implementer.md · L1–L5"
---
name: change-implementer
description: Implements exactly one OpenSpec change to v0 from a brief written by the /issue-build orchestrator. Dispatched by that skill, not by users.
model: opus
---
```

The `model` field accepts `sonnet`, `opus`, `haiku`, a full id such as `claude-opus-5-5`, or `inherit`. The Agent tool can also pass a `model` on each call, and that per-call value wins over the file. An agent knows nothing but its prompt: the skill that starts it writes a brief with everything the agent needs, and the agent's last message is its only way to report back. A skill that needs to answer an agent's question sends it a follow-up message rather than starting a new one, so the agent keeps its context.

## 7. Delegate to tools, do not restate them

Our skills do not explain how to write an OpenSpec proposal or how to archive a change. They call `/opsx:propose` and `/opsx:archive`, and read `openspec instructions … --json`, because the OpenSpec CLI is the source of truth for its own artifacts. A skill that restates a tool's job goes stale the day the tool changes. The body keeps only what the environment cannot tell Claude: the team's gates, the working-tree rules, the shape of the report.

:::warning[Gotcha]

Whether a skill body can start another skill through the Skill tool is not stated in the Claude Code docs. The pipeline relies on it for `/opsx:propose` and `/opsx:archive`. If a run shows it does not fire, the fallback is for the skill to ask the person to run the command.

:::

## Where skills live

| Folder | Scope | Committed |
| --- | --- | --- |
| `escalafy-app/.claude/skills/<name>/` | This repo, this machine | Only when allowlisted in `.gitignore` (`merge-conflicts-async`, `sentry-triage`) |
| `~/.claude/skills/<name>/` | Every project on this machine | No |
| `escalafy-docs/.claude/skills/<name>/` | This docs site | With the site |
| `escalafy-app/.claude/agents/<name>.md` | Agent definitions for this repo | Same rule as skills |

A skill in `.claude/skills/` is picked up by the next session that starts in that folder. Editing a skill's body takes effect the next time it is invoked.

## Terms

- **skill**: a folder with a `SKILL.md` that Claude follows when its name is typed or when its description matches.
- **front matter**: the key-value block between `---` lines at the top of `SKILL.md`.
- **pointer**: the always-loaded name and description; it decides when the body is reached.
- **recipe**: the body of `SKILL.md`; loaded only when the skill fires.
- **gate**: a moment where a person must decide before work continues; the natural cut between skills.
- **agent**: a separate Claude run started by a skill, defined in `.claude/agents/`, with its own model and prompt.
- **brief**: the prompt a skill writes for an agent; the agent's whole world.
