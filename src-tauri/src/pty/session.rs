use portable_pty::{Child, MasterPty};
use std::io::Write;
use std::sync::{Arc, Mutex};

pub struct PtySession {
    pub master: Mutex<Box<dyn MasterPty + Send>>,
    pub child: Mutex<Box<dyn Child + Send + Sync>>,
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
}

// Safety: All fields are wrapped in Mutex, so concurrent access is synchronized.
// MasterPty is Send but not Sync; wrapping in Mutex makes it safe for shared access.
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
