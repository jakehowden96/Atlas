use portable_pty::{Child, MasterPty};
use std::io::Write;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub struct PtySession {
    pub master: Mutex<Box<dyn MasterPty + Send>>,
    pub child: Mutex<Box<dyn Child + Send + Sync>>,
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
}

impl PtySession {
    pub fn write(&self, data: &[u8]) -> Result<(), String> {
        let mut writer = self.writer.lock().map_err(|e| e.to_string())?;
        writer.write_all(data).map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())?;
        Ok(())
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
    /// shell may still be winding down when the PTY reaches EOF.
    pub fn reap(&self, timeout: Duration) {
        let deadline = Instant::now() + timeout;
        loop {
            let Ok(mut child) = self.child.lock() else {
                return;
            };
            match child.try_wait() {
                Ok(None) if Instant::now() < deadline => {}
                _ => return,
            }
            drop(child);
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}
