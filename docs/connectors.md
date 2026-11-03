# Connectors

A connector links Atlas to an outside service. Two ship today: **Linear** (tickets) and **GitHub**
(pull requests). The `gh` CLI is not used.

## How sign-in works

OAuth only. There are no passwords and no personal access tokens. Both apps are public clients, so
no client secret exists anywhere.

| Provider | Flow | Scope | Code |
|---|---|---|---|
| Linear | Browser, PKCE, loopback redirect | `read` | `src-tauri/src/connectors/linear/` |
| GitHub | Device code (you type a code at github.com/login/device) | `repo` | `src-tauri/src/connectors/github/` |

The browser flow listens once on `http://127.0.0.1:<port>/callback`, using the first free port of
53682, 53683, 53684 (`LINEAR_REDIRECT_PORTS` in `connectors/clients.rs`). It accepts one callback and
gives up after five minutes. The shared flow code is in `connectors/oauth/` (`flow.rs`, `pkce.rs`,
`loopback.rs`, `device.rs`).

## What is stored where

| Data | Location |
|---|---|
| Refresh token and account name | OS keychain, service `atlas`, user `<connector-id>` (`connectors/keychain.rs`) |
| Access token | Memory only, refreshed shortly before it expires (`connectors/tokens.rs`) |
| Client ids | Source: `src-tauri/src/connectors/clients.rs` (public values) |
| Watched repos, refresh interval | `~/.atlas/settings.json` |

Disconnecting deletes the keychain entry.

## Unconfigured providers

A client id of `REPLACE_ME` means the app is not registered. The connector then shows "Not
configured in this build" and its Connect button is disabled. See [manual-setup.md](manual-setup.md).

## Adding a provider

1. Create `src-tauri/src/connectors/<id>/mod.rs` and implement `ConnectorProvider`
   (`connectors/provider.rs`), plus `PullRequestProvider` or the tickets trait for its kind. `info()`
   returns the id, name, kind, flow and `configured`; the auth config returns the client id, endpoints
   and scopes.
2. Add its client id (and redirect ports for a browser flow) to `connectors/clients.rs`, and use
   `is_configured` for `configured`.
3. Register it in `Registry::builtin()` in `connectors/registry.rs`.
4. Add a monochrome SVG (using `currentColor`) at `src/assets/connectors/<id>.svg` and add it to
   `LOGOS` in `src/lib/connector-logos.ts`. Without a logo the UI falls back to the initial.
5. Types that cross IPC derive `TS`; run `cargo test` in `src-tauri` and commit
   `src/types/generated/`.
6. Add the owner steps for the new app to [manual-setup.md](manual-setup.md) and its scope to
   [../SECURITY.md](../SECURITY.md).
