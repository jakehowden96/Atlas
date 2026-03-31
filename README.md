# Forge

A terminal app with a smart side panel that shows git diffs, summaries, and flow diagrams. Built with Tauri v2 (Rust backend) and Svelte 5 (TypeScript frontend).

## Prerequisites

- [Rust](https://rustup.rs/) (stable)
- [Node.js](https://nodejs.org/) (v20+)
- [pnpm](https://pnpm.io/)
- Tauri system dependencies: see [Tauri prerequisites](https://tauri.app/start/prerequisites/)

## Getting Started

```sh
pnpm install
pnpm tauri dev
```

This starts the Vite dev server and launches the Tauri desktop app with hot reload.

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
    stores/                   # Svelte stores (terminal, panel, toast)
    ipc.ts                    # Tauri IPC wrapper
    terminal-session.ts       # Terminal lifecycle management
    theme.ts                  # Tokyo Night color palette
    shortcuts.ts              # Keyboard shortcut handling
  types/                      # TypeScript type definitions

src-tauri/                    # Rust backend
  src/
    commands/
      terminal.rs             # PTY spawn/write/resize/kill commands
      panel.rs                # Git diff discovery + panel data
    pty/
      manager.rs              # PTY session lifecycle
      session.rs              # Individual PTY session I/O
    panel/
      watcher.rs              # File watcher for panel.json updates
```

### Data Flow

1. User types in terminal -> `ptyWrite()` -> Rust PTY -> shell process
2. Shell output -> Rust reader thread -> Tauri channel -> xterm.js render
3. CWD changes (OSC 7) -> `refreshPanel()` -> Rust git discovery -> `panel.json` -> file watcher -> `panel-update` event -> side panel

### Key Design Decisions

- **PTY management in Rust** — `portable-pty` for cross-platform terminal handling. Each tab gets its own PTY session with an incrementing ID.
- **Git diff discovery** — 3-tier fallback: working tree changes, unpushed commits, branch diff vs main/master.
- **File-based panel updates** — Panel data stored in `~/.forge/sessions/<id>/panel.json`. A file watcher debounces changes per session and emits Tauri events.
- **Theme system** — Tokyo Night palette defined once in `src/lib/theme.ts` and `app.css` CSS custom properties. Components reference `var(--color)` in styles and import the TS object for JS-side config (xterm, mermaid).

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
