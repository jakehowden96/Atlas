# Manual setup (owner only)

These steps need the repository owner's accounts or secrets. They are not done in the code, and no
key, secret or client id is committed for you. Until a step is done, the feature it enables stays
inert.

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

## 3. Updater signing key

Inert until done: **update checks are skipped** (the pubkey is still `REPLACE_WITH_UPDATER_PUBLIC_KEY`).

1. Run `pnpm tauri signer generate -w ~/.tauri/atlas.key`.
2. Put the public key in `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`.
3. In the repository's Settings > Secrets and variables > Actions, add `TAURI_SIGNING_PRIVATE_KEY`
   (contents of the `.key` file) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (if you set one).
4. Bump the version, update `CHANGELOG.md` and push a tag `vX.Y.Z`. The release workflow publishes
   the installers and `latest.json`, which `plugins.updater.endpoints` points at.

Never commit the private key. Losing it means installed copies cannot be updated.

## 4. Optional: code signing

Inert until done: Windows shows a SmartScreen warning; macOS needs "open anyway".

- macOS: add the `APPLE_*` secrets listed in [../SECURITY.md](../SECURITY.md).
- Windows: buy a code-signing certificate and add its signing step and secrets to
  `.github/workflows/release.yml`.

## 5. Verify against current Claude Code docs

`INSTALL_COMMANDS` in `src/lib/components/shell/ClaudeMissing.svelte` (the install one-liners shown
when `claude` is missing) was written from memory. Check both commands against the current Claude
Code install docs and correct them if they differ.
