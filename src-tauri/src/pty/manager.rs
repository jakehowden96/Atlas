use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::io::Read;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::thread;
use tauri::ipc::Channel;

use super::session::PtySession;

/// The interactive shell to run inside a PTY, plus its startup arguments.
///
/// `SHELL` is authoritative on Unix. On Windows it is deliberately ignored
/// unless it names a real Windows executable: MSYS/Git Bash export POSIX paths
/// such as `/bin/bash`, and handing one of those to `CreateProcessW` fails with
/// "The system cannot find the path specified" (os error 3) — which is exactly
/// how a hardcoded `/bin/zsh` used to break every session on Windows.
fn default_shell() -> (String, Vec<String>) {
    #[cfg(windows)]
    {
        if let Some(sh) = std::env::var("SHELL").ok().filter(|s| is_windows_exe(s)) {
            return (sh, Vec::new());
        }
        if let Some(pwsh) = find_on_path("pwsh.exe") {
            return (pwsh, vec!["-NoLogo".to_string()]);
        }
        if let Some(ps) = find_on_path("powershell.exe") {
            return (ps, vec!["-NoLogo".to_string()]);
        }
        (
            std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string()),
            Vec::new(),
        )
    }
    #[cfg(not(windows))]
    {
        // `-l` (login shell) is a POSIX-shell convention; it has no Windows analogue.
        let fallback = if cfg!(target_os = "macos") {
            "/bin/zsh"
        } else {
            "/bin/bash"
        };
        let shell = std::env::var("SHELL").unwrap_or_else(|_| fallback.to_string());
        (shell, vec!["-l".to_string()])
    }
}

/// True when `s` looks like a Windows executable path rather than a POSIX one.
#[cfg(windows)]
fn is_windows_exe(s: &str) -> bool {
    !s.starts_with('/') && std::path::Path::new(s).is_file()
}

/// Resolve a bare executable name against `PATH`.
#[cfg(windows)]
fn find_on_path(exe: &str) -> Option<String> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(exe))
        .find(|candidate| candidate.is_file())
        .map(|p| p.to_string_lossy().into_owned())
}

/// Claude Code session markers that must not reach a session Atlas spawns.
/// Deliberately an explicit list rather than a `CLAUDE*` prefix sweep: user
/// configuration such as `CLAUDE_CONFIG_DIR` shares the prefix and must survive.
const INHERITED_CLAUDE_MARKERS: &[&str] = &[
    "CLAUDECODE",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_EXECPATH",
    "CLAUDE_CODE_MESSAGING_SOCKET",
    "CLAUDE_CODE_MESSAGING_TOKEN",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_EFFORT",
    "CLAUDE_PID",
];

pub struct PtyManager {
    sessions: Arc<RwLock<HashMap<u32, PtySession>>>,
    next_id: AtomicU32,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            next_id: AtomicU32::new(1),
        }
    }

    pub fn spawn(
        &self,
        cols: u16,
        rows: u16,
        cwd: Option<String>,
        env_vars: Option<HashMap<String, String>>,
        on_data: Channel<Vec<u8>>,
    ) -> Result<u32, String> {
        let pty_system = native_pty_system();

        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };

        let pair = pty_system.openpty(size).map_err(|e| e.to_string())?;

        let (shell, shell_args) = default_shell();
        // `CommandBuilder::new` seeds the child's environment from this process,
        // so the shell inherits everything Atlas was launched with.
        let mut cmd = CommandBuilder::new(&shell);
        for arg in &shell_args {
            cmd.arg(arg);
        }

        if let Some(dir) = cwd {
            cmd.cwd(dir);
        }

        // A session Atlas spawns is a top-level Claude Code session. When Atlas
        // itself was launched from inside one (running `pnpm tauri dev` from a
        // Claude Code session, say), `CommandBuilder` seeds the child env from
        // this process, so the parent's session markers leak in: Claude then
        // sees CLAUDE_CODE_CHILD_SESSION, turns transcript saving off, and the
        // whole live-session engine goes dark with only a warning in the pane.
        // The messaging socket/token are worse — they are live handles to the
        // parent session's IPC.
        for key in INHERITED_CLAUDE_MARKERS {
            cmd.env_remove(key);
        }

        // Set TERM_PROGRAM so zsh/bash emit OSC 7 (CWD reporting)
        cmd.env("TERM_PROGRAM", "Atlas");
        cmd.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
        cmd.env("TERM", "xterm-256color");

        // Add custom env vars (restricted to ATLAS_ prefix for security)
        if let Some(vars) = env_vars {
            for (key, value) in vars {
                if key.starts_with("ATLAS_") {
                    cmd.env(key, value);
                } else {
                    log::warn!("Blocked non-ATLAS_ custom env var: {}", key);
                }
            }
        }

        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;

        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

        // Assign ID
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);

        let session = PtySession {
            master: Mutex::new(pair.master),
            child: Mutex::new(child),
            writer: Arc::new(Mutex::new(writer)),
        };

        self.sessions
            .write()
            .map_err(|e| e.to_string())?
            .insert(id, session);

        // The reader ends on EOF, which killing the child (or the shell
        // exiting) produces by closing the slave side.
        let sessions = Arc::clone(&self.sessions);
        let session_id = id;
        thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = buf[..n].to_vec();
                        if on_data.send(data).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            // Clean up the session when the reader exits
            if let Ok(mut sessions) = sessions.write() {
                sessions.remove(&session_id);
            }
        });

        Ok(id)
    }

    pub fn write(&self, id: u32, data: &[u8]) -> Result<(), String> {
        let sessions = self.sessions.read().map_err(|e| e.to_string())?;
        let session = sessions
            .get(&id)
            .ok_or_else(|| format!("Session {} not found", id))?;
        session.write(data)
    }

    pub fn resize(&self, id: u32, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.read().map_err(|e| e.to_string())?;
        let session = sessions
            .get(&id)
            .ok_or_else(|| format!("Session {} not found", id))?;
        session.resize(cols, rows)
    }

    pub fn kill(&self, id: u32) -> Result<(), String> {
        let mut sessions = self.sessions.write().map_err(|e| e.to_string())?;
        if let Some(session) = sessions.get(&id) {
            session.kill()?;
        }
        sessions.remove(&id);
        Ok(())
    }

    /// The tty device a session's shell runs on, e.g. `/dev/ttys001` — the
    /// breadcrumb OMP keys its own terminal-session files by.
    pub fn tty_name(&self, id: u32) -> Option<String> {
        let sessions = self.sessions.read().ok()?;
        let session = sessions.get(&id)?;
        let master = session.master.lock().ok()?;
        master.tty_name().map(|p| p.to_string_lossy().into_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::default_shell;

    #[test]
    fn claude_markers_are_stripped_but_user_config_survives() {
        use super::INHERITED_CLAUDE_MARKERS;
        assert!(INHERITED_CLAUDE_MARKERS.contains(&"CLAUDE_CODE_CHILD_SESSION"));
        assert!(INHERITED_CLAUDE_MARKERS.contains(&"CLAUDE_CODE_MESSAGING_TOKEN"));
        // A prefix sweep would take this too and break the user's own config.
        assert!(!INHERITED_CLAUDE_MARKERS.contains(&"CLAUDE_CONFIG_DIR"));
    }

    #[test]
    fn markers_are_removed_from_a_built_command() {
        use super::INHERITED_CLAUDE_MARKERS;
        use portable_pty::CommandBuilder;

        std::env::set_var("CLAUDE_CODE_CHILD_SESSION", "1");
        std::env::set_var("CLAUDE_CONFIG_DIR", "/tmp/keepme");

        let mut cmd = CommandBuilder::new("dummy");
        for key in INHERITED_CLAUDE_MARKERS {
            cmd.env_remove(key);
        }

        assert!(cmd.get_env("CLAUDE_CODE_CHILD_SESSION").is_none());
        assert!(cmd.get_env("CLAUDE_CONFIG_DIR").is_some());

        std::env::remove_var("CLAUDE_CODE_CHILD_SESSION");
        std::env::remove_var("CLAUDE_CONFIG_DIR");
    }

    #[test]
    fn default_shell_is_runnable_on_this_platform() {
        let (shell, args) = default_shell();
        assert!(!shell.is_empty(), "shell must not be empty");

        if cfg!(windows) {
            // The old hardcoded POSIX path is what CreateProcessW choked on.
            assert!(
                !shell.starts_with('/'),
                "Windows shell must not be a POSIX path, got {shell}"
            );
            assert!(
                std::path::Path::new(&shell).is_file() || shell.eq_ignore_ascii_case("cmd.exe"),
                "Windows shell must resolve to a real executable, got {shell}"
            );
            assert!(
                !args.iter().any(|a| a == "-l"),
                "-l is a POSIX login-shell flag and must not be passed on Windows"
            );
        } else {
            assert!(shell.starts_with('/'), "unix shell should be absolute");
            assert_eq!(args, vec!["-l".to_string()]);
        }
    }
}
