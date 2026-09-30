# Atlas

Mission control for [Claude Code](https://claude.com/claude-code). Run several sessions at once, watch every one of them live on a single grid, drop into any session's real terminal, review the diff it produced and comment straight back into the conversation, edit the plans and notes around a session, and keep an eye on open PRs across your repos. Built with Tauri v2 and Svelte 5. Named after my dog.
<p align="center">
  <img src="dog.png" alt="Atlas mascot" width="100">
</p>

## Features

- **Overview grid** — every running session as a live tile: state, the conversation's tail (your prompts, Claude's replies and the tools it called), running subagents, what it is doing right now, context, cost (subagents included) and diff counts. Sorted in the order you opened them by default, or needs-you first (Settings > General). When a permission prompt is showing on the session's screen, the tile offers Allow / Deny and types the answer into the real TUI; an OMP session blocked on its `ask` tool shows the question.
- **Session view** — the actual Claude Code terminal, so `/mcp`, `/resume`, `/model`, plan mode and Shift+Tab all keep working. Highlighting text copies it, whichever harness is running. Beside it, an activity rail with the plan checklist, subagents, turn stats and files touched. If the shell exits, the tab says so.
- **Resumable sessions** — Atlas spawns `claude --session-id <uuid>` and remembers it, so quitting and relaunching lets you pick a prior conversation back up with its history intact. The New Session modal offers Fresh or Resume per workspace.
- **Changes drawer** — the session's git diff as a slide-over: file tree, unified or split, viewed-state tracking, and inline review comments you can send back to the session as a prompt. Very large diffs are cut at a size cap and the drawer says how much was shown.
- **Pull requests** — open PRs across your watched repos grouped into cards, with CI and review status, All / Mine / Needs-my-review filters, and "Work on it" to check the branch out (fork PRs via `gh pr checkout`) and start a session on it. Backed by the `gh` CLI.
- **Files** — a three-column document workspace: Claude's plans (`~/.claude/plans`), your workspaces' documents and any folders you add, with a tabbed editor, Source / Split / Preview modes, an outline and links rail, and ⌘S to save. Saving refuses to overwrite a file that changed on disk since it was read, and unsaved edits are guarded on tab close and on quit. Source files get syntax highlighting; language servers (TypeScript/JavaScript, Svelte, Rust, Python, Go, when installed) are off by default and enabled per workspace in Settings > Workspaces, because a language server runs code from the workspace.
- **Stats** — a dense dashboard over your whole Claude Code history: per-model tokens and cost, tools and error rates, weekly activity by local day, per-workspace spend, recent sessions.
- **Live, not polled** — plan, subagents, tools, context and cost come from tailing `~/.claude/projects/**.jsonl`. Two Claude Code hooks tell Atlas when a session is waiting on you and when its session id changes (see [Hooks](#claude-code-hooks)).
- **Light, dark or system** — the whole app and the terminal re-theme together, with no restart.

## Install

### Download

Installers (macOS `.dmg` for Apple silicon and Intel, Windows `.exe`) are attached to each [GitHub release](https://github.com/jakehowden96/Atlas/releases). Release builds are produced by CI; signing and notarization depend on the repository's signing secrets being configured (see [SECURITY.md](SECURITY.md)). Unsigned builds need an explicit "open anyway" on macOS and trigger SmartScreen on Windows.

### Requirements

- [Claude Code](https://claude.com/claude-code) CLI (`claude`) — the thing Atlas manages
- `git` — the Changes drawer and workspace discovery
- [GitHub CLI](https://cli.github.com/) (`gh`), signed in with `gh auth login` — only for the Pull Requests screen

### Build from source

Prerequisites: Node 22.12+ (`.nvmrc`), [pnpm](https://pnpm.io/), Rust (the toolchain in `rust-toolchain.toml` is installed by `rustup` automatically) and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.

```sh
git clone https://github.com/jakehowden96/Atlas.git && cd Atlas && pnpm install && pnpm tauri build
```

macOS: the `.dmg` is in `src-tauri/target/release/bundle/dmg/`. Windows: the installer is in `src-tauri\target\release\bundle\nsis\`.

## Troubleshooting

Atlas finds `claude`, `gh` and `git` on the `PATH` it was launched with. A macOS app started from Finder does not get your shell's `PATH`, so Atlas adds the usual install locations itself (Homebrew, `~/.local/bin`, `~/.cargo/bin`, `~/.bun/bin`, npm-global, Volta, mise/asdf shims and the newest nvm Node). If something lives elsewhere, launch Atlas from a terminal or symlink the binary into one of those folders.

- **`claude` not found** — Settings > Claude Code shows the detected binary and version, or says none was found. Sessions cannot start until `claude` is installed.
- **`gh` missing or signed out** — the Pull Requests screen shows one message with the install and `gh auth login` commands instead of per-card errors.
- **`git` missing** — the Changes drawer says so and shows the install command.
- **A state file is corrupt** — `settings.json` and `workspaces.json` are kept as `<name>.json.bak` and Atlas starts from defaults, with a notice. Nothing is overwritten before the backup exists.
- **Logs** — `~/.atlas/logs/`, one file per day, pruned after 14 days. Frontend and backend log to the same file.

## Data locations

Everything Atlas owns is under `~/.atlas/`:

| Path | Contents |
|---|---|
| `settings.json` | Settings from the Settings modal. Versioned; written atomically. |
| `workspaces.json` | Workspaces, their sessions and saved Claude session ids, used for resume. |
| `stats.json` | Aggregated history for the Stats screen. Claude Code prunes old transcripts, so this may be the only remaining record of old sessions: it is backed up (`stats.json.bak`) rather than discarded on a format change. |
| `logs/` | Daily log files (`atlas-*.log`). |
| `sessions/<id>/` | Per-session working files: `panel.json` (diff and status for the Changes drawer) and the one-shot hook signals. |

Atlas reads `~/.claude/projects/` (transcripts). `~/.claude/plans/` is shown in Files and editable there on purpose. The only other file Atlas writes in `~/.claude/` is `settings.json`, for the hooks below.

## Claude Code hooks

Unless you switch it off (Settings > Claude Code), Atlas adds two entries to `~/.claude/settings.json` so Claude Code can tell it when a session needs you:

```jsonc
"hooks": {
  "Notification": [{ "matcher": "", "hooks": [{ "type": "command", "command": "\"<path to Atlas>\" hook notification" }] }],
  "SessionStart": [{ "matcher": "", "hooks": [{ "type": "command", "command": "\"<path to Atlas>\" hook session-start" }] }]
}
```

- Only entries whose command has exactly that shape are Atlas's. Your own hooks, and every other key in the file, are left alone.
- The edit is atomic, and the original file is copied once to `settings.json.atlas-bak` before the first change.
- If the file cannot be read or parsed, Atlas logs an error and does not touch it.
- If you move or update Atlas, the next launch rewrites its own entry to the new path.
- **To remove them**, turn off "Install Atlas's hooks" in Settings > Claude Code: Atlas deletes exactly the entries it added. Deleting the two entries by hand works as well. An older `atlas-notify-hook` shell entry from previous versions is removed on upgrade.

## Configuration

Settings are managed from the in-app Settings modal (gear icon) and persisted to `~/.atlas/settings.json`:

- **General** — appearance (System / Light / Dark), system notifications, sound on needs-you, terminal font size, Overview ordering
- **Keyboard** — every global shortcut can be rebound
- **Workspaces** — colour tag, linked repo and session count per workspace; add or remove folders; per-workspace language servers
- **Pull requests** — watched `owner/repo` list, auto-add repos from workspaces, and the refresh interval (1 / 3 / 10 minutes)
- **Claude Code** — the hooks switch, the transcript-tailing toggle, and the detected `claude` binary and version
- **Harnesses** — the commands New Session can launch (Claude Code, omp, a plain terminal, or your own)

## Development

```sh
pnpm install
pnpm tauri dev
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the checks CI runs.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘N` / `Ctrl+N` | New session |
| `⌘K` / `Ctrl+K` | Jump to session |
| `⌘,` / `Ctrl+,` | Settings |
| `⌘\` / `Ctrl+\` | Toggle the activity rail |
| `⌘1`–`⌘4` / `Ctrl+1`–`4` | Switch top-bar screen |
| `⌘S` / `Ctrl+S` | Save the open file (Files screen) |
| `⌘O` / `Ctrl+O` | Open a file (Files screen) |
| `Esc` | Close the topmost modal, then the Changes drawer, then back to Overview |

`Esc` is passed through to Claude Code while the terminal has focus and nothing
is open — the TUI owns it.

## Platform status

macOS (Apple silicon) is what development and manual testing happen on. Windows builds are produced and compiled by CI, but nothing in the Windows-specific code (process spawning without console windows, process-tree cleanup, path handling, ConPTY) has been run by the author; expect rough edges and please report them. Linux is not a target.
