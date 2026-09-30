use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::io::Read;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError, RwLock};
use std::thread;
use std::time::{Duration, Instant};
use tauri::ipc::{Channel, InvokeResponseBody};

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

/// Bytes read from one PTY per `read` call.
const READ_CHUNK: usize = 8192;

/// Output is sent to the webview in batches of about this size at most.
const MAX_BATCH: usize = 128 * 1024;

/// Minimum gap between two sends. A PTY read returns at most 1 KiB on macOS,
/// so sending each read on its own is a thousand IPC round trips per MiB; under
/// a flood (`yes`, `cat bigfile`) reads are coalesced for this long instead.
/// The first output after a quiet spell goes out at once, so keystroke echo
/// does not wait.
const MIN_SEND_INTERVAL: Duration = Duration::from_millis(4);

/// Output the reader has produced and the sender has not yet delivered.
struct Pending {
    bytes: Vec<u8>,
    /// The reader is done; send what is left and stop.
    eof: bool,
    /// `send` refused a batch (the webview is gone); stop reading.
    sink_closed: bool,
}

fn lock(pending: &Mutex<Pending>) -> MutexGuard<'_, Pending> {
    // Nothing panics while holding this lock, and the data stays consistent.
    pending.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Forward everything `reader` produces to `send`, in order and byte for byte,
/// in batches (see `MIN_SEND_INTERVAL`). `send` returns false once nobody is
/// listening. Returns true if the output ended at EOF, false if the read failed
/// or `send` gave up.
///
/// Memory is bounded: once `MAX_BATCH` bytes are waiting the reader stops
/// reading, which fills the PTY's own buffer and holds the shell back, rather
/// than queueing without limit.
fn pump_output<R: Read>(mut reader: R, send: impl FnMut(Vec<u8>) -> bool + Send) -> bool {
    let shared = (
        Mutex::new(Pending {
            bytes: Vec::new(),
            eof: false,
            sink_closed: false,
        }),
        Condvar::new(),
    );
    let (pending, changed) = &shared;

    thread::scope(|scope| {
        scope.spawn(move || send_batches(pending, changed, send));

        let mut buf = [0u8; READ_CHUNK];
        let reached_eof = loop {
            let n = match reader.read(&mut buf) {
                Ok(0) => break true,
                Ok(n) => n,
                Err(_) => break false,
            };
            let mut state = lock(pending);
            while state.bytes.len() >= MAX_BATCH && !state.sink_closed {
                state = changed.wait(state).unwrap_or_else(PoisonError::into_inner);
            }
            if state.sink_closed {
                break false;
            }
            state.bytes.extend_from_slice(&buf[..n]);
            changed.notify_all();
        };

        lock(pending).eof = true;
        changed.notify_all();
        reached_eof
    })
}

/// The sending half of `pump_output`: paces and delivers what the reader
/// accumulates, until the reader is done and nothing is left.
fn send_batches(
    pending: &Mutex<Pending>,
    changed: &Condvar,
    mut send: impl FnMut(Vec<u8>) -> bool,
) {
    let mut last_sent: Option<Instant> = None;
    loop {
        {
            let mut state = lock(pending);
            while state.bytes.is_empty() && !state.eof {
                state = changed.wait(state).unwrap_or_else(PoisonError::into_inner);
            }
            if state.bytes.is_empty() {
                return;
            }
        }

        // Output that arrives while this sleeps joins the batch.
        if let Some(sent) = last_sent {
            thread::sleep(MIN_SEND_INTERVAL.saturating_sub(sent.elapsed()));
        }

        let batch = std::mem::take(&mut lock(pending).bytes);
        changed.notify_all();
        last_sent = Some(Instant::now());
        if !send(batch) {
            lock(pending).sink_closed = true;
            changed.notify_all();
            return;
        }
    }
}

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
        on_data: Channel<InvokeResponseBody>,
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

        let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

        // Assign ID
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);

        let session = PtySession::new(pair.master, child, writer)?;

        self.sessions
            .write()
            .map_err(|e| e.to_string())?
            .insert(id, session);

        // The reader ends on EOF, which killing the child (or the shell
        // exiting) produces by closing the slave side.
        let sessions = Arc::clone(&self.sessions);
        let session_id = id;
        thread::spawn(move || {
            let reached_eof = pump_output(reader, |bytes| {
                on_data.send(InvokeResponseBody::Raw(bytes)).is_ok()
            });
            // Clean up the session when the reader exits, and reap a shell that
            // exited on its own so it does not stay a zombie until Atlas quits.
            let removed = sessions
                .write()
                .ok()
                .and_then(|mut sessions| sessions.remove(&session_id));
            if let (true, Some(session)) = (reached_eof, removed) {
                session.reap(Duration::from_secs(2));
            }
        });

        Ok(id)
    }

    pub fn write(&self, id: u32, data: Vec<u8>) -> Result<(), String> {
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

    /// Kill a session's shell. The session leaves the table first and is
    /// killed after the lock is released: `kill` waits out a shell that ignores
    /// SIGHUP, and every other tab's write and resize would queue behind it.
    pub fn kill(&self, id: u32) -> Result<(), String> {
        let removed = self
            .sessions
            .write()
            .map_err(|e| e.to_string())?
            .remove(&id);
        match removed {
            Some(session) => session.kill(),
            None => Ok(()),
        }
    }

    /// Kill every shell, in parallel so that quitting with several tabs open
    /// costs one kill grace period rather than one per tab. Called on app exit.
    pub fn kill_all(&self) {
        let drained: Vec<PtySession> = match self.sessions.write() {
            Ok(mut sessions) => sessions.drain().map(|(_, session)| session).collect(),
            Err(_) => return,
        };
        thread::scope(|scope| {
            for session in &drained {
                scope.spawn(move || {
                    if let Err(e) = session.kill() {
                        log::warn!("Could not kill a terminal on exit: {}", e);
                    }
                });
            }
        });
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
    use super::{default_shell, PtyManager};

    /// A live PTY session running `sleep`, inserted without a frontend channel.
    #[cfg(unix)]
    fn sleeping_session(manager: &PtyManager, id: u32) {
        use crate::pty::session::testing::session_with_writer;

        let session = session_with_writer("sleep", &["60"], Box::new(std::io::sink()));
        manager.sessions.write().unwrap().insert(id, session);
    }

    #[cfg(unix)]
    #[test]
    fn kill_all_stops_every_shell_and_forgets_them() {
        let manager = PtyManager::new();
        sleeping_session(&manager, 1);
        sleeping_session(&manager, 2);
        let pids: Vec<u32> = manager
            .sessions
            .read()
            .unwrap()
            .values()
            .map(|s| s.child.lock().unwrap().process_id().unwrap())
            .collect();

        manager.kill_all();

        assert!(manager.sessions.read().unwrap().is_empty());
        for pid in pids {
            // Signal 0 probes for existence; a reaped process is gone (ESRCH).
            let alive = std::process::Command::new("kill")
                .args(["-0", &pid.to_string()])
                .stderr(std::process::Stdio::null())
                .status()
                .unwrap()
                .success();
            assert!(!alive, "pid {pid} survived kill_all");
        }
    }

    /// Closing one tab must not freeze the others: `kill` waits out a shell
    /// that ignores SIGHUP (portable-pty escalates to SIGKILL only after a
    /// grace period), and it must do that without holding the session table.
    #[cfg(unix)]
    #[test]
    fn killing_a_slow_shell_does_not_stall_other_sessions() {
        use crate::pty::session::testing::session_with_writer;
        use std::sync::Arc;
        use std::time::{Duration, Instant};

        let manager = Arc::new(PtyManager::new());
        let stubborn = session_with_writer(
            "sh",
            &["-c", "trap '' HUP; while :; do sleep 1; done"],
            Box::new(std::io::sink()),
        );
        let bystander = session_with_writer("sleep", &["60"], Box::new(std::io::sink()));
        {
            let mut sessions = manager.sessions.write().unwrap();
            sessions.insert(1, stubborn);
            sessions.insert(2, bystander);
        }
        // Let the shell install its trap before it is signalled.
        std::thread::sleep(Duration::from_millis(300));

        let killer = {
            let manager = Arc::clone(&manager);
            std::thread::spawn(move || manager.kill(1))
        };
        std::thread::sleep(Duration::from_millis(30));

        let started = Instant::now();
        manager.write(2, b"x".to_vec()).unwrap();
        let waited = started.elapsed();

        killer.join().unwrap().unwrap();
        manager.kill(2).unwrap();
        assert!(
            waited < Duration::from_millis(100),
            "a write to another tab waited {waited:?} behind a kill"
        );
    }

    /// Hands out `data` in reads of `chunk` bytes, like a PTY does.
    struct Chunked {
        data: Vec<u8>,
        pos: usize,
        chunk: usize,
    }

    impl std::io::Read for Chunked {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            let n = self.chunk.min(buf.len()).min(self.data.len() - self.pos);
            buf[..n].copy_from_slice(&self.data[self.pos..self.pos + n]);
            self.pos += n;
            Ok(n)
        }
    }

    #[test]
    fn output_is_delivered_byte_for_byte_and_in_order_in_few_messages() {
        use super::{pump_output, MAX_BATCH, READ_CHUNK};

        // Every byte value, in a non-repeating order, 1 KiB per read.
        let data: Vec<u8> = (0..1 << 20)
            .map(|i: usize| (i.wrapping_mul(31) ^ (i >> 8)) as u8)
            .collect();
        let reader = Chunked {
            data: data.clone(),
            pos: 0,
            chunk: 1024,
        };

        let mut messages: Vec<Vec<u8>> = Vec::new();
        let reached_eof = pump_output(reader, |bytes| {
            messages.push(bytes);
            true
        });

        assert!(reached_eof);
        assert_eq!(messages.concat(), data);
        assert!(
            messages.iter().all(|m| m.len() < MAX_BATCH + READ_CHUNK),
            "a batch exceeded the cap"
        );
        assert!(
            messages.len() < 100,
            "1024 reads were sent as {} messages",
            messages.len()
        );
    }

    #[test]
    fn output_after_a_quiet_spell_is_sent_without_waiting_for_a_full_batch() {
        use super::pump_output;
        use std::io::Read;
        use std::sync::mpsc;
        use std::time::Duration;

        /// One short read, then silence until released, then EOF.
        struct OneKeystroke {
            release: mpsc::Receiver<()>,
            sent: bool,
        }
        impl Read for OneKeystroke {
            fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
                if !self.sent {
                    self.sent = true;
                    buf[..3].copy_from_slice(b"$ l");
                    return Ok(3);
                }
                let _ = self.release.recv();
                Ok(0)
            }
        }

        let (release_tx, release) = mpsc::channel();
        let (delivered_tx, delivered) = mpsc::channel();
        let pump = std::thread::spawn(move || {
            pump_output(
                OneKeystroke {
                    release,
                    sent: false,
                },
                move |bytes| delivered_tx.send(bytes).is_ok(),
            )
        });

        // The reader is still blocked: only an eager send can satisfy this.
        let first = delivered.recv_timeout(Duration::from_secs(2));
        release_tx.send(()).unwrap();
        assert!(pump.join().unwrap());
        assert_eq!(first.unwrap(), b"$ l");
    }

    #[test]
    fn pump_stops_reading_once_the_webview_stops_listening() {
        use super::pump_output;

        let endless = Chunked {
            data: vec![b'y'; 1 << 30],
            pos: 0,
            chunk: 8192,
        };
        let mut sent = 0;
        let reached_eof = pump_output(endless, |_| {
            sent += 1;
            false
        });

        assert!(!reached_eof);
        assert_eq!(sent, 1, "kept sending after the sink refused a batch");
    }

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
