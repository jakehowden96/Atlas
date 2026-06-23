# claude-stats CLI

A standalone CLI companion to the Atlas stats feature — backfill your Claude Code history, keep it live, and publish it to a shared GitHub Pages leaderboard.

## What's already built (in Atlas)

Atlas today embeds a full stats engine in its Rust backend (`src-tauri/src/commands/stats.rs`):

- **Session parser** — reads every `~/.claude/projects/**/*.jsonl` transcript, extracts token counts (input/output/cache), cost estimates, tool call names, tool errors, git branch, cwd, duration, and subagent count. Deduplicates on `requestId` so streamed multi-line assistant turns are counted once.
- **Incremental cache** — persists parsed sessions to `~/.atlas/stats.json`. On each recompute, only files whose `mtime` or `size` has changed are re-parsed; everything else is served from cache.
- **Aggregation** — rolls up totals, per-model-family breakdowns (Opus / Fable / Sonnet / Haiku), per-project, per-day, and a full tool-usage histogram.
- **Live watcher** — `notify`-based fs watcher on `~/.claude/projects/` debounces changes and re-emits `stats-update` Tauri events so the UI refreshes mid-session.
- **Stats tab** — a Svelte `StatsView` component accessible via the `monitoring` button in the Atlas header, showing a model comparison table, totals grid, tool usage bar chart, by-project table, and a rolling 30-day session calendar.

The shared data format is `StatsSummary` / `SessionRecord` (defined in `stats.rs` and mirrored in `src/types/stats.ts`). The CLI would reuse this same format.

---

## CLI design

### `claude-stats --init`

Backfill stats from all past Claude Code conversations on first run (or to force a full re-scan).

```
claude-stats --init [--dir ~/.claude/projects] [--out ~/.atlas/stats.json]
```

**What it does:**
1. Walks `~/.claude/projects/` (or a custom path) and discovers all session `.jsonl` files, including subagent dirs.
2. Parses each one with the same logic as `stats.rs::parse_session` — no API calls, pure local file reads.
3. Writes the full `StatsFile` (summary + per-session cache) to `~/.atlas/stats.json`.
4. Prints a summary to stdout: sessions scanned, total cost estimate, date range.

**Why a flag not the default:** `--init` signals "scan everything from scratch". The default run would be incremental (same as the in-app watcher). A fresh machine or a first install needs the full backfill explicitly.

---

### `claude-stats --listen`

Background daemon that keeps `~/.atlas/stats.json` up to date as Claude Code sessions run.

```
claude-stats --listen [--pid-file ~/.atlas/stats.pid] [--debounce 1000]
```

**What it does:**
1. Starts the same `notify` fs watcher that Atlas uses internally, watching `~/.claude/projects/` recursively.
2. On any `.jsonl` create/modify event (debounced to ~1s), runs the incremental recompute and overwrites `~/.atlas/stats.json`.
3. Writes its PID to `~/.atlas/stats.pid` so it can be killed cleanly.
4. Runs in the foreground by default; pipe to a process manager (launchd / systemd) to daemonise.

**Relationship to Atlas:** When Atlas is open, it runs its own watcher internally. `--listen` is for users who want the JSON file kept live without Atlas running — e.g. feeding a terminal widget, a Raycast extension, or the `--publish` pipeline.

---

### `claude-stats --publish`

Push your `stats.json` to a per-user branch in the `confused-org/claude-stats` repo, which GitHub Actions collates into a GitHub Pages leaderboard.

```
claude-stats --publish [--username <gh-username>] [--token <gh-pat>]
```

**What it does:**
1. Reads `~/.atlas/stats.json` (runs `--init` first if the file doesn't exist).
2. Strips any data you've opted out of — project paths are hashed by default, raw cwds only included with `--include-paths`.
3. Pushes `stats.json` to `confused-org/claude-stats` on a branch named `data/<username>`.
4. GitHub Actions (in the target repo) runs on push: collects all `data/*` branches, merges them into an aggregated `public/data.json`, and deploys to GitHub Pages.
5. Prints the public URL: `https://confused-org.github.io/claude-stats/`.

**Privacy defaults:**
- Project paths (`cwd`) are SHA-256 hashed to a short prefix — `atlas`, `partner-portal`, etc. are not exposed.
- Session titles are omitted.
- Token counts, cost, tool usage, and model breakdown are included — these are the interesting signals.
- Pass `--public` to include project names in the clear.

---

## Data model (shared between CLI and Atlas)

The `~/.atlas/stats.json` file is the contract between all three modes:

```jsonc
{
  "version": 1,
  "generatedAt": "2026-06-18T...",
  "summary": { /* StatsSummary */ },
  "sessions": [ /* SessionRecord[] */ ]
}
```

`StatsSummary` fields published per user:
- `totalSessions`, `totalUserMessages`, `totalOutputTokens`, `totalCostEstimate`
- `byModel` — per-family breakdown (Opus / Fable / Sonnet / Haiku)
- `toolUsage` — histogram of tool call counts
- `byDay` — daily session/message/token counts (last 90 days)
- `versions` — Claude Code version strings seen

`SessionRecord` fields **not** published (stay local only):
- `path` — absolute transcript path
- `cwd` — raw working directory
- `title` — AI-generated session title
- `gitBranch`

---

## GitHub Pages leaderboard (the `confused-org/claude-stats` repo)

The repo holds:
- `data/<username>/stats.json` — one branch per contributor, pushed by `--publish`
- A GitHub Action that triggers on any `data/**` push:
  1. Checks out all `data/*` branches
  2. Merges into `public/leaderboard.json` — aggregate by-model costs, total sessions, tool usage across all users
  3. Deploys to GitHub Pages

The page itself shows:
- Total sessions + estimated cost across all contributors
- Model comparison: who uses Opus vs Sonnet most (anonymised or named, user's choice)
- Top tools across the community
- Activity heatmap (daily sessions, no dates exposed — just relative activity)
- Per-user card (opt-in): username, sessions, cost estimate, favourite model

---

## Rough implementation plan

1. **Extract `stats.rs` into a shared crate** — `atlas-stats` in a new `crates/` workspace member. Both the Tauri backend and the CLI binary depend on it. Zero duplication.
2. **Add a `cli/` binary crate** — thin `clap` wrapper that delegates to `atlas-stats`. Three subcommands map to the three flags.
3. **`--init`** — trivially wraps `recompute()` which already exists.
4. **`--listen`** — pulls `start_stats_watcher` logic out of the Tauri-specific layer (it only needs an `AppHandle` for `emit`; replace with a file-write callback).
5. **`--publish`** — new: SHA-256 path hashing, `octocrab` (or raw `reqwest`) to push a file to a branch via the GitHub Contents API.
6. **GitHub Actions workflow** — separate PR in `confused-org/claude-stats`.

The Atlas app wires through the shared crate unchanged; the CLI is a thin shell on top of the same engine.
