use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
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
    shutdown_flags: Arc<RwLock<HashMap<u32, Arc<AtomicBool>>>>,
    next_id: Arc<Mutex<u32>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            shutdown_flags: Arc::new(RwLock::new(HashMap::new())),
            next_id: Arc::new(Mutex::new(1)),
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
        let mut cmd = CommandBuilder::new(&shell);
        for arg in &shell_args {
            cmd.arg(arg);
        }

        if let Some(dir) = cwd {
            cmd.cwd(dir);
        }

        // Inherit safe environment variables (whitelist approach to avoid leaking secrets)
        const SAFE_PREFIXES: &[&str] = &[
            "HOME", "USER", "LOGNAME", "SHELL", "PATH", "LANG", "LC_",
            "TERM", "COLORTERM", "EDITOR", "VISUAL", "PAGER", "LESS",
            "XDG_", "SSH_AUTH_SOCK", "DISPLAY", "TMPDIR", "TZ",
            "HOMEBREW_", "NVM_", "VOLTA_", "CARGO_HOME", "RUSTUP_HOME",
            "GOPATH", "GOROOT", "JAVA_HOME", "PYENV_",
            "FNM_", "BUN_INSTALL", "DENO_INSTALL",
        ];
        for (key, value) in std::env::vars() {
            if SAFE_PREFIXES.iter().any(|p| key.starts_with(p)) {
                cmd.env(key, value);
            }
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
        cmd.env("TERM_PROGRAM_VERSION", "0.1.0");
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

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| e.to_string())?;

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| e.to_string())?;

        // Assign ID
        let id = {
            let mut next = self.next_id.lock().map_err(|e| e.to_string())?;
            let id = *next;
            *next += 1;
            id
        };

        let session = PtySession {
            master: Mutex::new(pair.master),
            child: Mutex::new(child),
            writer: Arc::new(Mutex::new(writer)),
        };

        let shutdown = Arc::new(AtomicBool::new(false));

        self.sessions
            .write()
            .map_err(|e| e.to_string())?
            .insert(id, session);

        self.shutdown_flags
            .write()
            .map_err(|e| e.to_string())?
            .insert(id, Arc::clone(&shutdown));

        // Spawn reader thread with shutdown signal
        let sessions = Arc::clone(&self.sessions);
        let flags = Arc::clone(&self.shutdown_flags);
        let session_id = id;
        thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                if shutdown.load(Ordering::Relaxed) {
                    break;
                }
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
            // Clean up session and shutdown flag when reader exits
            if let Ok(mut sessions) = sessions.write() {
                sessions.remove(&session_id);
            }
            if let Ok(mut flags) = flags.write() {
                flags.remove(&session_id);
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
        // Signal the reader thread to stop
        if let Ok(flags) = self.shutdown_flags.read() {
            if let Some(flag) = flags.get(&id) {
                flag.store(true, Ordering::Relaxed);
            }
        }
        let mut sessions = self.sessions.write().map_err(|e| e.to_string())?;
        if let Some(session) = sessions.get(&id) {
            session.kill()?;
        }
        sessions.remove(&id);
        Ok(())
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
