use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::collections::HashMap;
use std::io::Read;
use std::sync::{Arc, Mutex, RwLock};
use std::thread;
use tauri::ipc::Channel;

use super::session::PtySession;

pub struct PtyManager {
    sessions: Arc<RwLock<HashMap<u32, PtySession>>>,
    next_id: Arc<Mutex<u32>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
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

        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let mut cmd = CommandBuilder::new(&shell);
        cmd.arg("-l"); // login shell

        if let Some(dir) = cwd {
            cmd.cwd(dir);
        }

        // Inherit parent environment
        for (key, value) in std::env::vars() {
            cmd.env(key, value);
        }

        // Set TERM_PROGRAM so zsh/bash emit OSC 7 (CWD reporting)
        cmd.env("TERM_PROGRAM", "Forge");
        cmd.env("TERM_PROGRAM_VERSION", "0.1.0");
        cmd.env("TERM", "xterm-256color");

        // Add custom env vars (e.g., FORGE_SESSION_ID)
        if let Some(vars) = env_vars {
            for (key, value) in vars {
                cmd.env(key, value);
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

        self.sessions
            .write()
            .map_err(|e| e.to_string())?
            .insert(id, session);

        // Spawn reader thread
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
            // Clean up session when reader exits
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

    pub fn kill_all(&self) {
        if let Ok(mut sessions) = self.sessions.write() {
            for (_, session) in sessions.drain() {
                let _ = session.kill();
            }
        }
    }
}
