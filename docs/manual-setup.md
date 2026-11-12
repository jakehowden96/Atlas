# Manual setup (owner only)

These steps need the repository owner's accounts. No client id is committed for you. Until a step is
done, the feature it enables stays inert.

The updater signing key is already set up: the public key is in `src-tauri/tauri.conf.json` and the
`TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repository secrets are set.
There is no release pipeline: a release is a tag `vX.Y.Z` plus a GitHub release with source only,
and users build the app themselves as the README describes. Bump the version and update
`CHANGELOG.md` first.

## 1. Linear OAuth app

Inert until done: **Connect is disabled** for Linear ("Not configured in this build"); no tickets.

1. In Linear: Settings > API > OAuth applications > New.
2. Name: `Atlas`. Make it a **public** client (PKCE, no client secret).
3. Redirect URIs, all three:
   - `http://127.0.0.1:53682/callback`
   - `http://127.0.0.1:53683/callback`
   - `http://127.0.0.1:53684/callback`

   These match `LINEAR_REDIRECT_PORTS` in `src-tauri/src/connectors/clients.rs`.
4. Copy the client id into `LINEAR_CLIENT_ID` in `src-tauri/src/connectors/clients.rs` (replace
   `REPLACE_ME`).

## 2. GitHub OAuth app

Inert until done: **Connect is disabled** for GitHub; the Pull requests screen has no data.

1. On GitHub: Settings > Developer settings > OAuth Apps > New OAuth App.
2. Name `Atlas`, homepage `https://github.com/jakehowden96/Atlas`. The callback URL is required by
   the form but unused by the device flow; use the homepage.
3. After creating it, tick **Enable Device Flow**.
4. Copy the client id into `GITHUB_CLIENT_ID` in `src-tauri/src/connectors/clients.rs`. Do not
   generate a client secret.
