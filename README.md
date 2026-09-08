# Atlas

Mission control for [Claude Code](https://claude.com/claude-code). Run several sessions at once, watch every one of them live on a single grid, drop into any session's real terminal, review the diff it produced and comment straight back into the conversation, and keep an eye on open PRs across your repos. Built with Tauri v2 and Svelte 5. Named after my dog.
<p align="center">
  <img src="dog.png" alt="Atlas mascot" width="100">
</p>

## Features

- **Overview grid** — every running session as a live tile: state, last six transcript lines, current step and plan progress, subagent count, context %, cost and diff counts. Sorted needs-you first (configurable). Permission prompts get an inline Allow/Deny that types the answer into the real TUI.
- **Session view** — the actual Claude Code terminal, so `/mcp`, `/resume`, `/model`, plan mode and Shift+Tab all keep working. Beside it, an activity rail with the plan checklist, subagents, turn stats and files touched.
- **Resumable sessions** — Atlas spawns `claude --session-id <uuid>` and remembers it, so quitting and relaunching lets you pick a prior conversation back up with its history intact. The New Session modal offers Fresh or Resume per workspace.
- **Changes drawer** — the session's git diff as a slide-over: file tree, unified or split, viewed-state tracking, and inline review comments you can send back to the session as a prompt.
- **Pull requests** — open PRs across your watched repos grouped into cards, with CI and review status, All / Mine / Needs-my-review filters, and "Work on it" to check the branch out and start a session on it. Backed by the `gh` CLI.
- **Stats** — a dense dashboard over your whole Claude Code history: per-model tokens and cost, tools and error rates, weekly activity, per-workspace spend, recent sessions.
- **Live, not polled** — plan, subagents, tools, context and cost come from tailing `~/.claude/projects/**.jsonl`. The only hook Atlas installs is `Notification`, which is what tells it a session is waiting on you.
- **Light, dark or system** — the whole app and the terminal re-theme together, with no restart.

## Install

### Prerequisites

- [Rust](https://rustup.rs/) (stable)
- [Node.js](https://nodejs.org/) (v20+)
- [pnpm](https://pnpm.io/)
- [Claude Code](https://claude.com/claude-code) CLI (`claude`)
- [GitHub CLI](https://cli.github.com/) (`gh`) — only needed for the Pull Requests screen
- Tauri system dependencies: see [Tauri prerequisites](https://tauri.app/start/prerequisites/)

### macOS

```sh
git clone https://github.com/jakehowden96/atlas.git && cd atlas && pnpm install && pnpm tauri build --bundles dmg
```

The `.dmg` will be in `src-tauri/target/release/bundle/dmg/`.

### Windows

```powershell
git clone https://github.com/jakehowden96/atlas.git; cd atlas; pnpm install; pnpm tauri build --bundles nsis
```

The installer will be in `src-tauri\target\release\bundle\nsis\`.

## Configuration

Settings are managed from the in-app Settings modal (gear icon) and persisted to `~/.atlas/settings.json`:

- **General** — appearance (System / Light / Dark), system notifications, sound on needs-you, terminal font size, Overview ordering, and skip-permissions
- **Workspaces** — colour tag, linked repo and session count per workspace; add or remove folders
- **Pull requests** — watched `owner/repo` list, auto-add repos from workspaces, and the refresh interval (1 / 3 / 10 minutes)
- **Claude Code** — hook status, the transcript-tailing toggle, and the detected `claude` binary and version

Logs are written to `~/.atlas/logs/` and per-session panel data to `~/.atlas/sessions/`.

## Development

```sh
pnpm install
pnpm tauri dev
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘N` / `Ctrl+N` | New session |
| `⌘K` / `Ctrl+K` | Jump to session |
| `⌘,` / `Ctrl+,` | Settings |
| `⌘\` / `Ctrl+\` | Toggle the activity rail |
| `Esc` | Close the topmost modal, then the Changes drawer, then back to Overview |

`Esc` is passed through to Claude Code while the terminal has focus and nothing
is open — the TUI owns it.

## Changed in 5.0.0

The old shell is gone. File tabs (`Ctrl+O` / `Ctrl+S`), standalone terminal
tabs, the workspace sidebar, and `Ctrl+Tab` / `Ctrl+1-9` tab switching were all
removed in favour of the Overview grid and the four-screen shell. Sessions are
now resumable across restarts, and the Everforest theme was replaced by the
Mission Control palette with real System / Light / Dark support.
