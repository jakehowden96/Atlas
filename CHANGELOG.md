# Changelog

## Unreleased

Production-hardening pass. Behavior changes are listed under "Changed"; everything else fixes a
defect found in the audit.

### Security

- `.vscode/mcp.json` held a live API key and was committed to history. It is untracked and ignored;
  `.vscode/mcp.json.example` replaces it. **The key must be rotated; it remains in git history.**
- The webview has no filesystem permissions any more. Settings, workspaces and logs are read and
  written by Rust commands.
- The Files view can only read and write inside registered workspaces, folders you added, and
  `~/.claude/plans`. `~/.atlas/**` and `~/.claude/settings*.json` are always refused.
- Language servers no longer start automatically: they are enabled per workspace in Settings, and
  crashed servers are cleaned up.
- Git is run with `--no-ext-diff --no-textconv --no-color`, `-z` paths and `GIT_OPTIONAL_LOCKS=0`;
  checkouts use `refs/heads/`, `--no-guess` and `--`. Untracked symlinks are not followed. Fork PRs
  are checked out with `gh pr checkout`.
- Dependencies updated within their ranges: `pnpm audit` went from 20 advisories (9 high) to none.
- Removed the unused `tauri-plugin-shell`; added `tauri-plugin-single-instance`.

### Fixed: data loss

- Atlas no longer replaces `~/.claude/settings.json` with just its hooks when the file fails to
  parse. The file is left untouched, writes are atomic, and the original is copied once to
  `settings.json.atlas-bak`. Key order and trailing newline are preserved.
- A corrupt or truncated `settings.json`/`workspaces.json` is saved as `.bak` instead of being
  silently overwritten with defaults. Writes are atomic, serialised and versioned.
- `stats.json` is written atomically and backed up on a format change; old records whose
  transcripts Claude Code has pruned are carried forward. A transient read failure no longer drops
  a session's history.
- Files view: a file that failed to load can no longer be saved over with an empty buffer; closing a
  dirty tab or quitting asks first; saving refuses to overwrite a file that changed on disk; saves
  are atomic and keep symlinks and permissions; edits typed during a save are not marked saved.
- Hook signal files and `panel.json` are written atomically.

### Fixed: correctness

- Stats no longer hangs forever on a transcript path that raises a read error (a directory named
  `*.jsonl` spun at 100% CPU while holding the stats lock).
- Prompts with pasted images or attachments are read (they were invisible and left the session shown
  as finished); a new prompt marks the session working at once; tool calls orphaned by a killed
  Claude no longer keep a session "waiting" forever.
- Stats: tool errors and duration are no longer counted once per model; days are local days, and
  spend is booked to the day it happened; resumed sessions that copy earlier requests are not
  double-counted; `todayCost` no longer books a whole old conversation to today; subagents are part
  of the cache key.
- Live tails read new bytes in bounded chunks and notice a replaced file; resuming a session that
  already has a transcript shows its state immediately; stopping during startup no longer leaves an
  orphan tail; OMP sessions are noticed even if `~/.omp` appears after launch.
- The Files editor is built once per document (it was rebuilt on every keystroke, resetting the
  caret); external edits of an open file reload it or raise a conflict.
- Terminal tabs: a PTY spawned after its tab closed is killed; spawn failures show an error and the
  row moves to an error state; a shell that exits is reported instead of leaving a frozen terminal.
- Claude hook: a stale path from a moved or dev build is replaced rather than left dangling.
- Symlinked folders are followed in the Open dialog and repo discovery.
- Stats, PR and panel refreshes are ordered and no longer toast repeatedly.
- Dozens of smaller fixes: see the audit commit messages (`git log productionize`).

### Changed

- Allow / Deny on a tile (and the bare `y` / `n` keys) act only when a permission prompt is actually
  on the session's screen.
- A second launch focuses the running Atlas instead of starting another.
- The "sound on needs-you" setting now plays a short ping.
- Native notifications also fire when the notifying tab is active but Atlas is not focused.
- Settings > Claude Code can switch Atlas's hooks off; doing so removes exactly the entries Atlas
  added.
- The Changes drawer says when a diff was truncated and when `git` is missing; the Pull Requests
  screen explains when `gh` is missing, signed out or timing out.
- Stats windows book cost and tokens by the day they were spent.
- Font size stepper moves by whole pixels; reserved chords cannot be bound as shortcuts.
- PTY output is sent as raw bytes (1.004x overhead instead of 3.57x on a 1 MiB burst) with bounded
  back-pressure, and PTY writes/kills no longer block the main thread.
- The app icon font is a 6.6 KB subset (was 3.9 MB). Release binary: 15.3 MB to 7.1 MB
  (LTO, `opt-level = "s"`, stripped, unused plugins removed); the macOS dmg is 3.8 MB.

### Build and release

- CI (`.github/workflows/ci.yml`), a tag-driven release workflow, and Dependabot.
- Toolchain pinned: Rust 1.94.0, Node >=22.12; MIT license; SECURITY.md and CONTRIBUTING.md.
- IPC errors are a typed enum; the TypeScript types for everything crossing IPC are generated from
  Rust with ts-rs.
