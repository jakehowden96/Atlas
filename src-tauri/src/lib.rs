mod commands;
mod panel;
mod pty;

use pty::manager::PtyManager;

pub fn run() {
    let pty_manager = PtyManager::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(pty_manager)
        .invoke_handler(tauri::generate_handler![
            commands::terminal::pty_spawn,
            commands::terminal::pty_write,
            commands::terminal::pty_resize,
            commands::terminal::pty_kill,
            commands::panel::get_session_dir,
            commands::panel::get_panel_data,
            commands::panel::refresh_panel,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            // Start file watcher for panel updates
            let _watcher = panel::watcher::start_watcher(handle)
                .expect("Failed to start panel watcher");
            // Keep watcher alive by leaking it (it needs to live for the app lifetime)
            Box::leak(Box::new(_watcher));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
