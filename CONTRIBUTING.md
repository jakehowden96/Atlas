# Contributing

## Setup

Prerequisites: Node 22 (`.nvmrc`), pnpm, the Rust toolchain pinned in `rust-toolchain.toml`, and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.

```sh
pnpm install
pnpm tauri dev
```

## Before you push

CI runs exactly these; run them locally first.

```sh
# repo root
pnpm check && pnpm lint && pnpm format:check && pnpm test && pnpm build
node scripts/check-versions.mjs

# src-tauri/
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

`pnpm format` and `cargo fmt` fix formatting. Warnings are errors.

## Conventions

- One logical change per commit; the message says why.
- A bug fix comes with a test that fails without it.
- The IPC contract is three files that change together: `src-tauri/src/commands/*`,
  `src/lib/ipc.ts` and `src/types/*`.
- The app version lives in `package.json`, `src-tauri/Cargo.toml` and
  `src-tauri/tauri.conf.json`; `scripts/check-versions.mjs` fails if they differ.
- Windows is a supported target but is only exercised by CI; say so in a PR when you change
  platform-specific code you could not run.

## Releasing

Bump the three versions, update `CHANGELOG.md`, and push a tag `vX.Y.Z`. The release workflow builds
the macOS (arm64 and x86_64) and Windows installers into a draft GitHub release.
