# Handoff: Session rail (ActivityRail redesign)

> Copied verbatim from the Claude Design project (`design_handoff_session_rail/README.md`).
> **Where this plan overrides it:** (1) tile open/closed choices persist **globally per tile type**, not per session; (2) the PR tile refreshes every **60s**, not 30s, and only while the rail is visible; (3) the ticket is linked by the user typing an ID per session, from a connector, not inferred from the branch; (4) PR data comes from a GitHub connector over HTTPS, not `gh pr view`, so the `gh failed` copy becomes provider-neutral; (5) tile order, copy and layout are otherwise as written here.

## Overview
A redesign of the right-hand activity rail in the Atlas session view: the 300px column beside the live Claude Code terminal. The rail used to be Plan, Subagents, Turn stats and Files touched in one scroll. It is now:

1. **A pinned Info header** showing the ticket, branch and worktree, a waiting strip, and the session numbers.
2. **Three tiles beneath it, in fixed order:** Plan, Agents and PR.

Test runs, the tool count and the files-touched list are gone.

The goal is a rail you can read at a glance. Collapsed tiles are plain sentences. Expanded tiles list every item with what it is doing. Colour is used only for state.

## Fidelity
**High fidelity.** Every colour, size and radius is an Atlas token. Use the token names and never hard-code hex values.

---

## Layout

### Rail shell
- `aside`: width 300px, full height of the session view, `background: var(--bg)`, `border-left: 1px solid var(--border)`.
- It is a flex column with two children:
  1. **Header block:** `flex-shrink: 0`, never scrolls.
  2. **Tile scroller:** `flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 8px; display: flex; flex-direction: column; gap: 8px`.
- Keep the existing slide-in and slide-out keyframes (`atlasSlideIn` 0.22s `cubic-bezier(0.2,0.8,0.2,1)`, `atlasSlideOut` 0.2s) and the `⌘\` toggle.

### Info header (pinned, never collapses, no chevron)
The header has no label and no state dot; the ticket is the heading. From top to bottom:

1. **Waiting strip.** Shown only while the *session* needs the user.
   - Style: `padding: 9px 16px; border-bottom: 1px solid var(--border); color: var(--warn); font-size: var(--fs-xs) (13px); font-weight: 500; line-height: 18px`. One line, end ellipsis.
   - Copy: `Waiting for you: wants to run Bash`, i.e. "Waiting for you: " followed by the hook's prompt summary.
   - Subagents never show a needs-you state.
2. **Ticket block.**
   - Container: `background: var(--surface2); padding: 16px 16px 14px; display: grid; gap: 8px; min-height: 134px`. The min-height keeps the header the same height with or without a ticket.
   - Row 1 is flex `space-between`:
     - Ticket ID: `--font-mono`, 13px, 600, `--text` (`ENG-482`).
     - Status chip: `height: 22px; padding: 0 9px; border-radius: 11px; font-size: 12px; font-weight: 600; border: 1px solid`. The chip is never filled. Colours by status:
       - In Progress: text `--accent`, ring `currentColor`.
       - In Review: text `--warn`, ring `currentColor`.
       - Done: text `--muted`, ring `--border2`.
       - Backlog and Todo: text `--text`, ring `--border2`.
   - Title: `--fs-lg` (16px), 600, line-height 22px, `text-wrap: pretty`. It wraps and is never truncated.
   - Branch and worktree line: mono 12px, `--muted`, one line, in the form `atlas/billing-retry · retry-metrics`. If it is longer than about 36 characters, ellipsise it **in the middle**: keep the head and tail, put `…` in between.
   - With no ticket, replace the ID row and title with `No ticket linked` (14px, `--muted`). Keep the branch line.
3. **Meter strip.** `background: var(--surface3)`.
   - Top edge: a full-bleed 2px context line. Track `--border2`, fill width = context %. Fill is `--accent`, or `--warn` above 75%.
   - Below it, a grid `minmax(0,.85fr) minmax(0,1.25fr) minmax(0,1fr)` with `gap: 8px; padding: 10px 16px 12px`. Each cell is a 12px `--muted` label above a mono 15px (`--fs-md`), weight 500, tabular-nums value:
     - `Context` / `64%`
     - `● Sonnet` / `$4.18`. The 6px dot is `--model-opus`, `--model-sonnet` or `--model-haiku`, followed by the model name.
     - `Elapsed` / `48m 12s`. Format as `Xm SSs` under an hour and `Xh MMm` from an hour.
   - Elapsed ticks every second. Cost updates live.

### Tiles (Plan, Agents, PR)
**Shell**
- `background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-card-lg) (10px)`. No shadow and no fill change.
- The ring becomes `--danger` when the tile's state is failed, or `--warn` when it needs attention. Nothing else changes.

**Header row**
- It is a button covering the whole row: `padding: 10px 14px`, grid `6px | 1fr | auto | 10px`, `column-gap: 10px`, `align-items: start`.
- Columns:
  - **Col 1:** the state dot, vertically centred in a 20px box.
  - **Col 2:** the headline sentence, 14px, line-height 20px, wraps. It opens with a run-in label: 12px, 600, `letter-spacing: .06em`, uppercase, `--muted`, `margin-right: 8px`.
  - **Col 3:** empty.
  - **Col 4:** a `▸` twisty, 12px `--muted`, rotated 90° when open, `transition: transform 120ms ease`. (The system handoff replaces the glyph with the `chevron_right` icon and the dot with the status mark.)

**Collapsed detail** sits under the headline (col 2–3, row 2):
- Plan: a 2px progress line (`--surface3` track, `--muted` fill).
- Agents and PR: 13px `--muted` text, clamped to 2 lines.
- PR when a refresh has failed: also a 12px mono `--warn` line.

**Expanded body**
- `padding: 0 14px 14px; display: grid; gap: 14px`.
- Groups appear in this order: **running → needs attention → other → done**. Inside a group, `gap: 10px`.

**Item row**
- Grid `6px | 1fr | 10px`, `column-gap: 10px`.
- Dot: in a 20px box at the top-left.
- Title: 14px, line-height 20px, wraps, clamped at 2 lines.
- Status line: 13px, line-height 18px, `--muted`. It opens with a 500-weight status word in the state colour, e.g. `running 7m 28s, 14 tool calls`.
- Agents only:
  - A 12px mono meta line: agent type, plus a branch chip. Chip style: `padding: 0 5px; border: 1px solid var(--border2); border-radius: 3px; line-height: 16px`. Show the chip only when the session spans more than one worktree.
  - A 12px mono `--muted` current-action line (e.g. `Reading src/retry.rs`), one line with end ellipsis.

**Lists and done groups**
- Each list group shows at most 3 rows, then a 13px `--muted` `+n more running` (or `+n more next`) row that expands inline and then reads `show fewer`.
- The done group is a toggle row: hollow `--muted` dot, then `5 done` or `6 passed` in 13px `--muted`, then a twisty. It is closed by default.

### Thin rail (48px)
- `background: var(--bg)`.
- Top band in `--surface2`:
  - A `--warn` dot, only while the session is waiting.
  - The ticket ID in mono 12px, 600, rotated (`writing-mode: vertical-rl; transform: rotate(180deg)`). With no ticket it reads `no ticket`.
- Below the band, one 6px state dot per tile (Plan, Agents, PR), 22px apart, each with a tooltip naming the tile.

---

## State dots and colour
Every dot is 6px, `border-radius: 50%`. (The system handoff's **status mark** replaces dots: shape carries state.)

- **running:** filled `--accent`, `animation: atlasPulse 1.6s ease-in-out infinite` (opacity 1 → .35 → 1).
- **failed:** filled `--danger`.
- **attention:** filled `--warn`.
- **done** (done, passed, merged, approved): hollow, `1.5px solid var(--muted)`.
- **not yet** (next, awaiting, empty, open, draft): hollow, `1.5px solid var(--border2)`.

Colour rules:
- Colour is for state only, and always sits beside a word.
- `--accent` text marks running and healthy states, `--danger` failed, `--warn` attention.
- No fills, gradients or shadows.
- Numbers and status words never truncate.

## Section content

**Plan**
- Collapsed: `Step 11 of 14: Parse Retry-After as an HTTP date`. "Step 11 of 14:" is weight 500. The step name wraps. A progress line follows.
- When finished: `All 6 steps done`. With no plan: `No plan yet` in `--muted`.
- Expanded header: `Step 11 of 14, 10 done`.
- Rows, in groups:
  - Current step: running dot, `in progress · step 11 of 14` with "in progress" in `--accent`.
  - Next steps: not-yet dot, `--muted` title, `next · step 12`.
  - A `10 done` toggle that expands to the done steps.
- Under the rows, a `Open plan file →` link (13px `--muted`, `--text` on hover). It opens the workspace's newest plan, using the existing `openPlan()` logic.

**Agents**
- Collapsed headline: `4 running, 5 done`. "4 running" is `--accent` 500; ", 5 done" is `--muted`.
- Collapsed detail: the first two running task names, comma-separated, plus `+n` (2-line clamp).
- Empty: `No agents yet`.
- Running rows:
  - Title: the task.
  - Status line: `running {elapsed, ticking}, {n} tool calls`.
  - Meta line: type and chip.
  - Action line: the current action.
- Done rows: `done in 1m 05s, 6 tool calls`.

**PR**
- Collapsed headline: `#482 open, 1 of 7 checks failing, 3 review comments`.
  - Separators are ", ". Each phrase uses `white-space: nowrap`, so lines break only at a comma.
  - "#n state" is 500 (`--muted` when the PR is a draft).
  - CI phrase:
    - `n of t checks failing`: `--danger`.
    - `n of t checks running`: `--accent`.
    - `t checks passed`: `--muted`.
  - Review phrase:
    - `awaiting review`: `--muted`.
    - `n review comments`: `--warn`.
    - `changes requested`: `--warn`.
    - `approved`: `--accent`.
- Collapsed detail: the PR title.
- Empty: `No PR for this branch yet`.
- Expanded header: `#482 open`. Under it, the title (14px 500, 2 lines), then the polling line in 12px mono:
  - Normally `updated 12s ago` in `--muted`.
  - When a refresh fails, `last updated 3m ago, <provider> failed` in `--warn`, and the tile ring turns `--warn`.
- Rows:
  - **Running:** one row per pending check: running dot, the check name, `running`.
  - **Needs attention:**
    - One row per failing check: danger dot, the check name, `failing, 6 other checks passed`. The "passed" clause appears on the last failing row only.
    - The Review row when it is comments or changes requested: warn dot.
  - **Other:** the Review row (`awaiting review` not-yet dot, `approved` done dot with `--accent` word).
  - **Done:** a `6 passed` toggle listing the passed checks.
- The Review row is a single row with no author. It counts unresolved review comments from anyone, Copilot included.
- PR states are open, draft and merged. Draft text is muted; merged uses the done dot.

**Tile state (dot and ring)**
- **Plan:** running while a step is in progress; done when finished; not-yet when there is no plan.
- **Agents:** running if any agent is running; done if all are done; not-yet when there are none.
- **PR:** failed if any check is failing; otherwise attention if the review has comments, changes are requested or polling failed; otherwise running if any check is pending; otherwise done if merged; otherwise not-yet.

## Interactions and behaviour
- **Auto-open:** a tile opens when its state is running, failed or attention, and collapses when it settles.
- **Manual override:** clicking a tile header flips it, and that choice sticks. **Plan override: stored globally per tile type**, not per session.
- **Lists:** "done" and "+n more" toggles are local and sticky for the life of the view only.
- **Fixed order:** the order never changes. Empty tiles keep their one-line state.
- **Clock:** reuse the 1s `now` the session view already passes in.
  - Agent elapsed = `now − startedAt`.
  - Header elapsed = `now − session.startedAt`.
  - PR "updated" = `now − lastPollAt`. **Plan override: the PR refreshes every 60s while the rail is visible.**
- **No action buttons anywhere.** The only controls are disclosures and the plan-file link (plus the ticket editor in the system handoff).
- **Width:** the rail stays 300px. Text truncates only for file paths and branch chips (end ellipsis) and the branch line (middle ellipsis). Titles wrap and clamp at 2 lines (the ticket title at 3).
- **Thin rail:** a 48px state for narrow windows, or as a collapse step before fully hiding the rail.

## State and data
| Data | Source |
| --- | --- |
| Ticket: `id`, `title`, `status` (Backlog / Todo / In Progress / In Review / Done) | Ticket connector, keyed by the ID the user typed for this session |
| `branch`, `worktree` | Existing `tile.branch`; worktree from the session cwd |
| `model` (Opus / Sonnet / Haiku) | Session transcript |
| `contextPct`, `costEstimate`, `startedAt` | Existing `tile.live` |
| `waiting` prompt summary | The existing Notification hook (needs-you state) |
| Plan items | Existing `live.plan` / `planRowState` |
| Subagents: `task`, `type`, `startedAt`, `done`, `toolCalls`, `worktree`, `currentAction` | Existing `live.subagents`, plus `type`, `worktree` and `currentAction` (last tool call summary) |
| PR: `number`, `title`, `state` (open / draft / merged), `checks[{name, status: pending / pass / fail}]`, `review` (awaiting / comments(n) / changes / approved), `lastPollAt`, `pollError` | Pull-request connector, for the current branch, polled every 60s |

## Design tokens (from `src/app.css`)
| Token | Light | Dark |
| --- | --- | --- |
| `--bg` | #f5f5f7 | #0f1012 |
| `--surface` | #ffffff | #16171a |
| `--surface2` | #f0f0f3 | #1d1f23 |
| `--surface3` | #e5e5ea | #25272c |
| `--border` | rgba(0,0,0,.08) | rgba(255,255,255,.08) |
| `--border2` | rgba(0,0,0,.14) | rgba(255,255,255,.16) |
| `--text` | #17181b | #e6e7ea |
| `--muted` | #474a50 | #acb2bc |
| `--accent` | #217457 | #2fa37a |
| `--warn` | #846122 | #e0a53a |
| `--danger` | #b1403a | #f55950 |

- **Model colours** (same in both themes): `--model-opus` #8b7cf6, `--model-sonnet` #4aa3df, `--model-haiku` #e089b8.
- **Type:** Geist Variable (`--font-ui`) and Geist Mono Variable (`--font-mono`). Sizes: `--fs-2xs` 12, `--fs-xs` 13, `--fs-sm` 14, `--fs-md` 15, `--fs-lg` 16. Weights: body 450, medium 500, semi 600. Nothing is smaller than 12px.
- **Radii:** `--r-xs` 3px (branch chips), `--r-card-lg` 10px (tiles). The status chip is a pill.
- **Spacing used:** 8px rail padding and gap between tiles; 10/14 tile header padding; 16px header padding; dot column 6px plus 10px gap.

## Files
- **Replaces:** `src/lib/components/session/ActivityRail.svelte`.
- **Touches:** `SessionView.svelte`, which already passes `tile` and `now`.
- Design reference: `Session Rail v6.dc.html` (fixture data and section-building logic are in its `<script>` block: `planSec`, `agentSec`, `prSec`, `infoData`, `FIX`; use it as a spec for derived strings).
