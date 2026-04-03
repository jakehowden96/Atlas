use portable_pty::{Child, MasterPty};
use std::io::Write;
use std::sync::{Arc, Mutex};

pub struct PtySession {
    pub master: Mutex<Box<dyn MasterPty + Send>>,
    pub child: Mutex<Box<dyn Child + Send + Sync>>,
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
}

// SAFETY: PtySession fields are all wrapped in `Mutex`, which provides interior
// mutability with exclusive access guarantees. `MasterPty` is `Send` but not `Sync`;
// since every access goes through `Mutex::lock()` (which ensures only one thread
// touches the inner value at a time), the composite type is safe to share across
// threads. The same reasoning applies to `Box<dyn Write + Send>` in `writer`.
// Invariant: no code path accesses the inner values without first acquiring the lock.
unsafe impl Sync for PtySession {}

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
        let mut child = self.child.lock().map_err(|e| e.to_string())?;
        child.kill().map_err(|e| e.to_string())
    }
}
