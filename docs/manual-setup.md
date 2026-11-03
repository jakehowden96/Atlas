# Manual setup (owner only)

These steps need the repository owner's accounts. No client id is committed for you. Until a step is
done, the feature it enables stays inert.

The updater signing key is already set up: the public key is in `src-tauri/tauri.conf.json` and the
`TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repository secrets are set. To
publish a release, bump the version, update `CHANGELOG.md` and push a tag `vX.Y.Z`; the release
workflow publishes the installers and `latest.json`.

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

## 3. Optional: code signing

Inert until done: Windows shows a SmartScreen warning; macOS needs "open anyway".

- macOS: add the `APPLE_*` secrets listed in [../SECURITY.md](../SECURITY.md).
- Windows: buy a code-signing certificate and add its signing step and secrets to
  `.github/workflows/release.yml`.
