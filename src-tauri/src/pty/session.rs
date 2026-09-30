use portable_pty::{Child, ExitStatus, MasterPty};
use std::io::Write;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub struct PtySession {
    pub master: Mutex<Box<dyn MasterPty + Send>>,
    pub child: Mutex<Box<dyn Child + Send + Sync>>,
    /// Input for the shell, in the order it was written. A thread of its own
    /// performs the actual writes: a PTY nobody is reading (a paste into
    /// `sleep`) blocks `write_all` indefinitely, and that must never be the
    /// webview's thread.
    input: Sender<Vec<u8>>,
}

impl PtySession {
    pub fn new(
        master: Box<dyn MasterPty + Send>,
        child: Box<dyn Child + Send + Sync>,
        writer: Box<dyn Write + Send>,
    ) -> Result<Self, String> {
        let (input, queue) = channel();
        std::thread::Builder::new()
            .name("pty-input".into())
            .spawn(move || drain_input(queue, writer))
            .map_err(|e| e.to_string())?;
        Ok(Self {
            master: Mutex::new(master),
            child: Mutex::new(child),
            input,
        })
    }

    /// Queue `data` for the shell. Returns as soon as it is queued; fails once
    /// the PTY's input has closed (the shell is gone or a write failed).
    pub fn write(&self, data: Vec<u8>) -> Result<(), String> {
        self.input
            .send(data)
            .map_err(|_| "Terminal input is closed".to_string())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        let master = self.master.lock().map_err(|e| e.to_string())?;
        master
            .resize(portable_pty::PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())
    }

    pub fn kill(&self) -> Result<(), String> {
        self.child
            .lock()
            .map_err(|e| e.to_string())?
            .kill()
            .map_err(|e| e.to_string())?;
        self.reap(Duration::from_secs(1));
        Ok(())
    }

    /// Collect the shell's exit status so it does not linger as a zombie
    /// (dropping a child never waits). Polls for at most `timeout`, because the
    /// shell may still be winding down when the PTY reaches EOF. `None` if it
    /// had not exited by then.
    pub fn reap(&self, timeout: Duration) -> Option<ExitStatus> {
        let deadline = Instant::now() + timeout;
        loop {
            let Ok(mut child) = self.child.lock() else {
                return None;
            };
            match child.try_wait() {
                Ok(Some(status)) => return Some(status),
                Ok(None) if Instant::now() < deadline => {}
                _ => return None,
            }
            drop(child);
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}

/// Write queued input to the PTY until the session is dropped or a write
/// fails. A failure ends the thread, which closes the queue, so later
/// `PtySession::write` calls report it instead of queueing into the void.
fn drain_input(queue: Receiver<Vec<u8>>, mut writer: Box<dyn Write + Send>) {
    for chunk in queue {
        if let Err(e) = writer.write_all(&chunk).and_then(|()| writer.flush()) {
            log::warn!("Terminal input write failed: {e}");
            return;
        }
    }
}

#[cfg(test)]
pub(crate) mod testing {
    use super::PtySession;
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};
    use std::io::Write;

    /// A session whose child is `program args…` on a real PTY, but whose input
    /// goes to `writer` instead of the PTY, so a test controls how fast it
    /// drains.
    pub(crate) fn session_with_writer(
        program: &str,
        args: &[&str],
        writer: Box<dyn Write + Send>,
    ) -> PtySession {
        let pair = native_pty_system().openpty(PtySize::default()).unwrap();
        let mut cmd = CommandBuilder::new(program);
        cmd.args(args);
        let child = pair.slave.spawn_command(cmd).unwrap();
        PtySession::new(pair.master, child, writer).unwrap()
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::testing::session_with_writer;
    use std::io::Write;
    use std::sync::{mpsc, Arc, Condvar, Mutex};
    use std::time::Duration;

    type Gate = Arc<(Mutex<bool>, Condvar)>;
    type Seen = Arc<Mutex<Vec<u8>>>;

    /// A PTY nobody reads: every write blocks until the gate opens.
    struct GatedWriter {
        gate: Gate,
        seen: Seen,
    }

    impl Write for GatedWriter {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            let (open, cv) = &*self.gate;
            let mut open = open.lock().unwrap();
            while !*open {
                open = cv.wait(open).unwrap();
            }
            self.seen.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    fn gated() -> (GatedWriter, Gate, Seen) {
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let seen = Arc::new(Mutex::new(Vec::new()));
        let writer = GatedWriter {
            gate: Arc::clone(&gate),
            seen: Arc::clone(&seen),
        };
        (writer, gate, seen)
    }

    fn open_gate(gate: &(Mutex<bool>, Condvar)) {
        *gate.0.lock().unwrap() = true;
        gate.1.notify_all();
    }

    /// The webview's thread must never wait on a PTY that is not draining its
    /// input (a paste into a `sleep`, say): the caller hands the bytes over and
    /// returns.
    #[test]
    fn write_returns_while_the_pty_is_not_draining() {
        let (writer, gate, _seen) = gated();
        let session = session_with_writer("sleep", &["60"], Box::new(writer));

        let (done_tx, done_rx) = mpsc::channel();
        let caller = std::thread::spawn(move || {
            let result = session.write(vec![b'x'; 1 << 20]);
            done_tx.send(result).unwrap();
            session
        });

        let returned = done_rx.recv_timeout(Duration::from_secs(2));
        open_gate(&gate);
        let session = caller.join().unwrap();
        assert!(
            returned.is_ok(),
            "write blocked on a PTY that is not reading"
        );
        session.kill().unwrap();
    }

    /// Off-thread delivery must not reorder bytes: what the caller wrote first
    /// reaches the PTY first.
    #[test]
    fn writes_reach_the_pty_in_call_order() {
        let (writer, gate, seen) = gated();
        let session = session_with_writer("sleep", &["60"], Box::new(writer));

        let mut expected = Vec::new();
        for i in 0..500u32 {
            let chunk = format!("<{i}>").into_bytes();
            expected.extend_from_slice(&chunk);
            session.write(chunk).unwrap();
        }
        open_gate(&gate);

        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while seen.lock().unwrap().len() < expected.len() {
            assert!(std::time::Instant::now() < deadline, "writes never drained");
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(*seen.lock().unwrap(), expected);
        session.kill().unwrap();
    }
}
