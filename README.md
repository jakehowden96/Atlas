# Atlas

A desktop terminal with an intelligent side panel that automatically detects git changes and shows diffs, AI-generated summaries, and flow diagrams. Built with Tauri v2 (Rust backend) and Svelte 5 (TypeScript frontend).

## Features

- **Multi-tab terminal** with PTY-backed shell sessions (xterm.js)
- **Automatic git detection** — side panel appears when you navigate into a git repo, hides when you leave
- **3-tier diff discovery** — working tree changes, unpushed commits, or branch diff vs main/master
- **Multi-repo support** — parent directories with multiple git repos are aggregated into a single view
- **AI-powered analysis** — optional Anthropic API integration for commit summaries and flow diagrams
- **Check for Updates** — fetch from remote and pull with one click
- **Folder exclusions** — browse or type folder names to exclude from repo scanning
- **Selective file staging** — check/uncheck individual files before committing
- **Large diff handling** — files over 500 lines collapse behind an expand toggle
- **Keyboard-driven** — shortcuts for tabs, panel views, and navigation

## Installation

Download the latest release from the [Releases](https://github.com/jakehowden96/forge/releases) page.

- **macOS**: Download the `.dmg`, open it, and drag Atlas to Applications
- **Windows**: Download the `.exe` installer and run it

## Configuration

Atlas stores its config at `~/.atlas/config.json`. You can set:

- **API key** — configure via the UI (Summary or Flow view) or set the `ANTHROPIC_API_KEY` environment variable
- **Excluded folders** — configure via Settings (gear icon in the side panel)

## Building from Source

### Prerequisites

- [Rust](https://rustup.rs/) (stable)
- [Node.js](https://nodejs.org/) (v20+)
- [pnpm](https://pnpm.io/)
- Tauri system dependencies: see [Tauri prerequisites](https://tauri.app/start/prerequisites/)

### Development

```sh
pnpm install
pnpm tauri dev
```

### Production Build

```sh
pnpm tauri build --bundles dmg    # macOS
pnpm tauri build --bundles msi    # Windows
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm tauri dev` | Run in development mode |
| `pnpm tauri build` | Build production binary |
| `pnpm test` | Run frontend tests (Vitest) |
| `pnpm check` | Run svelte-check type checking |
| `pnpm lint` | Run ESLint |
| `pnpm format` | Format code with Prettier |
| `cargo test` | Run Rust backend tests (from `src-tauri/`) |

## Architecture

```
src/                          # Svelte 5 frontend
  lib/
    components/
      terminal/               # TerminalContainer, TabBar, TerminalTab
      panel/                  # SidePanel, DiffViewer, SummaryView, FlowDiagram
      layout/                 # Resizer
    stores/                   # Svelte stores (terminal, panel, settings, toast)
    ipc.ts                    # Tauri IPC wrapper
    terminal-session.ts       # Terminal lifecycle management
    theme.ts                  # Color palette (surfaces, accents, ANSI)
    shortcuts.ts              # Keyboard shortcut handling
  types/                      # TypeScript type definitions

src-tauri/                    # Rust backend
  src/
    commands/
      terminal.rs             # PTY spawn/write/resize/kill commands
      panel.rs                # Git diff discovery, panel data, git operations
    pty/
      manager.rs              # PTY session lifecycle with shutdown signals
      session.rs              # Individual PTY session I/O
    panel/
      watcher.rs              # File watcher for panel.json updates
    claude.rs                 # Anthropic API client for AI analysis
    lib.rs                    # App config (~/.atlas/config.json)
```

### Data Flow

1. User types in terminal -> `ptyWrite()` -> Rust PTY -> shell process
2. Shell output -> Rust reader thread -> Tauri channel -> xterm.js render
3. CWD changes (OSC 7) -> `refreshPanel()` -> Rust git discovery -> `panel.json` -> file watcher -> `panel-update` event -> side panel
4. AI analysis -> async Claude API call -> results merged into `panel.json` -> emitted to frontend

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+T` | New tab |
| `Ctrl+W` | Close tab |
| `Ctrl+1-9` | Switch to tab |
| `Ctrl+Shift+\` | Toggle side panel |
| `Ctrl+Shift+D` | Show diff view |
| `Ctrl+Shift+S` | Show summary view |
| `Ctrl+Shift+F` | Show flow diagram |
| `Ctrl+Shift+R` | Refresh panel |
