# Security

## Reporting a vulnerability

Use GitHub's private vulnerability reporting on this repository (Security tab, "Report a
vulnerability"). Please do not open a public issue for security problems.

## Threat model

Atlas is a local desktop app. It has no server and sends no telemetry. It spawns your shell and
Claude Code in pseudo-terminals, reads Claude Code transcripts under `~/.claude/`, runs `git` and
`gh` in your workspaces, and stores its own state under `~/.atlas/`.

Anything running in the app's webview can call Atlas's IPC commands, so the webview is the trust
boundary, and the backend does not trust it:

- **No webview filesystem access.** The webview has no fs plugin permission. Settings, workspaces and
  logs go through Rust commands that build the path themselves, validate the content and write
  atomically.
- **Files view is scoped.** Reading and writing documents is limited to registered workspaces,
  folders you added with the native picker, and `~/.claude/plans`. `~/.atlas/**` and
  `~/.claude/settings*.json` are refused even inside a granted folder; paths are canonicalised, `..`
  is refused and symlinks cannot escape a root. Limit of this: a compromised webview can still call
  the commands that register workspaces, so this is defense in depth on top of the CSP, not a
  sandbox.
- **Language servers run workspace code**, so they are off per workspace until you enable them in
  Settings, and the decision is read by the backend from `settings.json`, not passed in by the
  webview.
- **Subprocesses** (`git`, `gh`, language servers) are started without a shell and with validated
  arguments, `--` before user-controlled refs, and no console window on Windows.
- **Claude Code settings.** Atlas edits only its own two hook entries in `~/.claude/settings.json`
  (see the README), never when the file does not parse, and you can switch it off.
- **Content security policy.** `default-src 'self'; script-src 'self'; connect-src 'self' ipc:
  http://ipc.localhost`. `style-src` keeps `'unsafe-inline'` because CodeMirror (`style-mod`) and
  xterm.js inject `<style>` elements at runtime; removing it would break both. No remote scripts,
  frames or fetch targets are allowed.
- **Windows browser flags.** `additionalBrowserArgs` in `tauri.conf.json` disables three WebView2
  features (`msWebOOUI`, `msPdfOOUI`, `msSmartScreenProtection`) and LCD text. SmartScreen URL
  reputation is off inside the webview, which only ever loads the bundled app. `[UNVERIFIED on
  Windows]`: these flags have not been run on Windows by the author.

## Secrets

Never commit credentials. `.vscode/mcp.json` is gitignored; copy `.vscode/mcp.json.example` and put
your key in your own copy or in the prompt VS Code shows.

## Release signing secrets

The release workflow (`.github/workflows/release.yml`) reads these repository secrets by name. None
have values in the repository.

| Secret | Purpose |
|---|---|
| `APPLE_CERTIFICATE` | Base64 of the Developer ID Application `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | Password for that `.p12` |
| `APPLE_SIGNING_IDENTITY` | Signing identity, e.g. `Developer ID Application: Name (TEAMID)` |
| `APPLE_ID` | Apple ID used for notarization |
| `APPLE_PASSWORD` | App-specific password for that Apple ID |
| `APPLE_TEAM_ID` | Apple developer team ID |

Windows installers are currently not code-signed; SmartScreen will warn on first run. Add a signing
certificate and its secrets to the workflow to change that.
