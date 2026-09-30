# Security

## Reporting a vulnerability

Use GitHub's private vulnerability reporting on this repository (Security tab, "Report a
vulnerability"). Please do not open a public issue for security problems.

## Threat model

Atlas is a local desktop app. It has no server and sends no telemetry. It spawns your shell and
Claude Code in pseudo-terminals, reads Claude Code transcripts under `~/.claude/`, runs `git` and
`gh` in your workspaces, and stores its own state under `~/.atlas/`. Anything running in the app's
webview can call Atlas's IPC commands, so the webview is treated as the trust boundary: the content
security policy allows scripts only from the app itself, and commands that touch the filesystem or
spawn processes validate their arguments in Rust rather than trusting the frontend.

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
