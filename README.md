# Atlas

A desktop cockpit for running [Claude Code](https://claude.com/claude-code) sessions. Organise sessions by workspace in a sidebar, watch live git diffs in a side panel as Claude works, leave inline review comments that are sent straight back to the session, and keep an eye on open PRs across your repos. Built with Tauri v2 and Svelte 5. Named after my dog.
<p align="center">
  <img src="dog.png" alt="Atlas mascot" width="100">
</p>

## Features

- **Workspace sidebar** — add project folders, spawn Claude sessions in each, and switch between them. Sessions show live diff badges and a "needs input" indicator when Claude is waiting on you.
- **Diff panel** — automatically detects git changes in the active session's repo and renders them as split or unified diffs, with per-file collapse and viewed-state tracking.
- **Inline review comments** — comment on diff lines and send the batch to the Claude session as a prompt.
- **Pull Requests screen** — native view of open PRs (CI and review status) across your watched repos, backed by the `gh` CLI.
- **Terminal & file tabs** — plain terminals and read/edit file tabs alongside Claude sessions.
- **Notifications** — installs a Claude Code hook so the app (and macOS) can notify you when a session needs input.

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

- **Skip permissions** — launch sessions with `claude --dangerously-skip-permissions`
- **Notifications** — OS notifications when a session needs input
- **Watched repos** — `owner/repo` slugs shown on the Pull Requests screen

Logs are written to `~/.atlas/logs/` and per-session panel data to `~/.atlas/sessions/`.

## Development

```sh
pnpm install
pnpm tauri dev
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+O` | Open file |
| `Ctrl+S` | Save active file |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Cycle tabs |
| `Ctrl+1-9` | Switch to tab |
| `Ctrl+Shift+[` / `Ctrl+Shift+]` | Previous / next workspace |
| `Ctrl+Shift+\` | Toggle side panel |
| `Ctrl+Shift+R` | Refresh panel |
