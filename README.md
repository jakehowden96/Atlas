# Atlas

<p align="center">
  <img src="dog.png" alt="Atlas mascot" width="200">
</p>

A desktop terminal with an intelligent side panel that automatically detects git changes and shows diffs, AI-generated summaries, and flow diagrams. Built with Tauri v2 and Svelte 5.

## Install

### Prerequisites

- [Rust](https://rustup.rs/) (stable)
- [Node.js](https://nodejs.org/) (v20+)
- [pnpm](https://pnpm.io/)
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

Atlas stores its config at `~/.atlas/config.json`:

- **API key** — configure via the UI (Summary or Flow view) or set the `ANTHROPIC_API_KEY` environment variable
- **Excluded folders** — configure via Settings (gear icon in the side panel)

## Development

```sh
pnpm install
pnpm tauri dev
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+T` | New tab |
| `Ctrl+W` | Close tab |
| `Ctrl+1-9` | Switch to tab |
| `Ctrl+Shift+\` | Toggle side panel |
| `Ctrl+Shift+D` | Diff view |
| `Ctrl+Shift+S` | Summary view |
| `Ctrl+Shift+F` | Flow diagram |
| `Ctrl+Shift+R` | Refresh panel |
