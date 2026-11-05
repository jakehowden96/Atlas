# Atlas Stats: design field to codeburn source

Design: `Atlas Stats - Atlas Nav.html`. Fixtures: `src/lib/components/stats/codeburn/__fixtures__/<cmd>.json` (codeburn 0.9.27; large arrays trimmed to 5 rows).
`P` = `-p/--period` (today, week, 30days, month, all).

## Filter support per command

| Command | --project | --provider | --from/--to | Period |
|---|---|---|---|---|
| `status --format json` | yes | yes | yes | `--period` (menubar-json only) |
| `report --format json` | yes | yes | yes | P |
| `sessions --format json` | yes | yes | yes | P |
| `models --format json` | yes | yes | yes | P |
| `spend --format flow-json` | yes | yes | yes | P |
| `compare --format json` | yes | yes | yes | P |
| `compare-periods --format json` | yes | yes | `--from-a/--to-a/--from-b/--to-b` (required, no P) | no |
| `optimize --format json` | yes | yes | yes | P |
| `yield --format json` | yes | yes | NO | P |
| `plan --format json` | no | yes | no | no |
| `quota --format json` | no | no | no | no (live) |

All project-capable commands also take `--exclude`. Yield cannot honor a custom range: fall back to the nearest period or show "—".

## Field map

| Design field | Command | JSON path / derivation |
|---|---|---|
| Hero total (selected range) | `report` | `overview.cost` (calls: `overview.calls`, sessions: `overview.sessions`) |
| Today total | `status` | `today.cost`, `today.calls` |
| Yesterday | `report` | `daily[]` entry for yesterday's date, `.cost` (period must cover it) |
| 7-day avg | `report` | mean of last 7 `daily[].cost` |
| vs yesterday % | `report` | derived: today vs yesterday from `daily[]` |
| Streak | `report` | derived: consecutive trailing `daily[]` days with `calls > 0` |
| Efficiency ring + grade | `report` | derived blend of one-shot, cache hit, retry tax; grade letter also available as `optimize` `summary.healthGrade` |
| One-shot | `report` | `sum(daily[].oneShotTurns) / sum(daily[].editTurns)` (or `daily[].oneShotRate`); per model `models[].oneShotRate` |
| Cache hit | `report` | `overview.cacheHitPercent` |
| Retry tax ($ and % of spend) | `report` | derived: `sum(models[].retriesPerEdit * models[].costPerEdit * models[].editTurns)` over `overview.cost`; exact `compare` `[].retries` is a count only |
| Activity grid (calls per day) | `report` | `daily[].date`, `daily[].calls` |
| Month to date | `status` | `month.cost` |
| vs last month pace % | `compare-periods` | `totals.pct.cost` (A = last month window, B = this month window) |
| Projected month | `status` | derived: `month.cost` / day-of-month * days-in-month |
| Daily spend by model | `spend` / `report` | per-day by model: none directly (spend gives model x project totals). Existing app timeline is the source; `report` `daily[].cost` for totals only |
| Spend by model tier legend | `spend` | `models[].id/label/cost` |
| By project | `spend` | `projects[].label/cost`, `links[]` |
| Workflow: correction rate | `compare` | derived: `selfCorrections / editTurns` per model |
| Workflow: time to first edit | none: show — | |
| Workflow: top rework file | `optimize` | `topReworkedFiles[0]` (`path`, `sessions`, `edits`) |
| Pace banner (% vs last week) | `compare-periods` | `totals.pct.cost` with last-week windows |
| Pace banner (recoverable $) | `optimize` | `summary.potentialSavingsCostUSD` |
| Pace banner (biggest driver model) | `compare-periods` | `models[]` max `diff` |
| Wins | `report` + `optimize` | derived from cache hit, one-shot, streak; `optimize` `summary.byClass.keep` |
| Improvements | `optimize` | `findings[]` where `class` is `fix` or `nudge` |
| Risks | `report` + `compare-periods` | derived: peak day from `daily[]`, projected-vs-last-month from `totals.pct.cost` |
| Cost per outcome ($/commit) | `yield` | derived: `summary.productive.costUSD / sum(details[].commitCount)` |
| Cost per productive session | `yield` | `summary.productive.costUSD / summary.productive.sessions` |
| Productive / reverted / abandoned % | `yield` | `summary.{productive,reverted,abandoned}.costPercent` |
| Top activities | `report` | `activities[]` (`category`, `cost`, `turns`, `oneShotRate`) |
| Expensive sessions | `sessions` | sort by `cost` desc; or `report` `topSessions[]` |
| Models table | `models` | `[].modelDisplayName/calls/costUSD/totalTokens`; one-shot via `report` `models[].oneShotRate` |
| Model compare / category head-to-head | `compare` | `[]` (`oneShotTurns`, `editTurns`, `editCost`); per-category: `compare --format cohort-json` |
| Per-model days of data, fast-mode % | `compare` | `firstSeen`/`lastSeen`; fast-mode %: none: show — |
| Waste / findings list | `optimize` | `findings[]` (`title`, `severity`, `tokensSaved`, `estimatedSavingsUSD`, `fix`) |
| Waste applied fixes | `optimize` | `appliedFixes[]` |
| Sessions list | `sessions` | `[]` (`title`, `project`, `models`, `cost`, `startedAt`, `durationMs`) |
| Quota windows | `quota` | `providers[].windows[]` (`label`, `usedPct`, `resetsAt`), `providers[].plan` |
| Plans page | `plan` | `id`, `monthlyUsd`, `provider`, `resetDay` |
| Plugins list | none: show — | codeburn has no plugin concept; list providers from `quota` `providers[].name` |
| Settings | none: show — | Atlas-owned; `plan`, `currency` and `budget` are codeburn CLI config, not read-only JSON |
