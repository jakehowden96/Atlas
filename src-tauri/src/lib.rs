#![deny(unsafe_code)]
mod atomic_write;
mod claude_hook;
mod commands;
pub mod error;
pub mod hook;
mod lsp;
mod panel;
mod pty;
mod session;
mod state;
mod transcript;

use pty::manager::PtyManager;
use session::manager::LiveSessionManager;
use tauri::menu::{Menu, MenuItemBuilder, WINDOW_SUBMENU_ID};
use tauri::{Emitter, Manager};

const BACK_TO_SESSIONS_MENU_ID: &str = "back-to-sessions";

/// Log to stderr and, when `~/.atlas/logs` is usable, to a dated file there.
/// A missing home directory or an unwritable log directory degrades to
/// stderr-only rather than aborting before the window opens.
fn setup_logging() {
    let mut dispatch = fern::Dispatch::new()
        .format(|out, message, record| {
            out.finish(format_args!(
                "[{}] [{}] [{}] {}",
                chrono::Local::now().format("%H:%M:%S%.3f"),
                record.level(),
                record.target(),
                message
            ))
        })
        .level(log::LevelFilter::Info)
        .chain(std::io::stderr());

    let log_dir = dirs::home_dir().map(|h| h.join(".atlas").join("logs"));
    match &log_dir {
        Some(dir) => match std::fs::create_dir_all(dir) {
            Ok(()) => {
                dispatch = dispatch.chain(fern::DateBased::new(
                    dir.join("atlas-backend-"),
                    "%Y-%m-%d.log",
                ));
            }
            Err(e) => eprintln!(
                "could not create {}: {e} — logging to stderr only",
                dir.display()
            ),
        },
        None => eprintln!("could not resolve the home directory — logging to stderr only"),
    }

    if let Err(e) = dispatch.apply() {
        eprintln!("could not start logging: {e}");
    }

    if let Some(dir) = log_dir {
        clean_old_logs(&dir, LOG_RETENTION_DAYS);
    }
}

/// How long dated backend logs are kept.
const LOG_RETENTION_DAYS: u64 = 14;

/// Delete Atlas's own dated logs (`atlas-*.log`) not modified for
/// `max_age_days`. Other files in the directory are none of our business.
fn clean_old_logs(log_dir: &std::path::Path, max_age_days: u64) {
    let cutoff =
        std::time::SystemTime::now() - std::time::Duration::from_secs(max_age_days * 24 * 60 * 60);
    let Ok(entries) = std::fs::read_dir(log_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !(name.starts_with("atlas-") && name.ends_with(".log")) {
            continue;
        }
        if let Ok(meta) = entry.metadata() {
            if let Ok(modified) = meta.modified() {
                if modified < cutoff {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
    }
}

/// Route panics to the log. A Finder-launched macOS app and the Windows
/// `windows_subsystem = "windows"` build have no visible stderr, so without
/// this a panic in a background thread (watcher, PTY or LSP reader) kills the
/// feature with no trace in `~/.atlas/logs`.
fn install_panic_hook() {
    std::panic::set_hook(Box::new(|info| {
        let location = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_else(|| "unknown location".to_string());
        let payload = info.payload();
        let message = payload
            .downcast_ref::<&str>()
            .copied()
            .or_else(|| payload.downcast_ref::<String>().map(String::as_str))
            .unwrap_or("non-string panic payload");
        let thread = std::thread::current();
        log::error!(
            "panic in thread '{}' at {}: {}\n{}",
            thread.name().unwrap_or("<unnamed>"),
            location,
            message,
            std::backtrace::Backtrace::force_capture()
        );
    }));
}

/// Directories where user-level installers put `claude`, `node` and friends,
/// relative to the home directory. A Finder/Dock launch gets launchd's bare
/// PATH and would otherwise miss all of them, though the login-shell PTY finds
/// them.
const HOME_BIN_DIRS: &[&str] = &[
    ".local/bin", // Claude Code's native installer
    ".volta/bin",
    ".local/share/mise/shims",
    ".asdf/shims",
    ".bun/bin",
    ".npm-global/bin",
    ".cargo/bin",
];

/// System-wide locations: Homebrew on Apple Silicon and on Intel.
const SYSTEM_BIN_DIRS: &[&str] = &["/opt/homebrew/bin", "/usr/local/bin"];

/// The newest `~/.nvm/versions/node/<version>/bin`, if nvm is installed. nvm
/// only puts a version on PATH from a shell's rc file, which a GUI never runs.
fn newest_nvm_bin(home: &std::path::Path) -> Option<std::path::PathBuf> {
    let versions = home.join(".nvm").join("versions").join("node");
    let mut dirs: Vec<(Vec<u64>, std::path::PathBuf)> = std::fs::read_dir(versions)
        .ok()?
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let parts = name
                .trim_start_matches('v')
                .split('.')
                .map(|p| p.parse().ok())
                .collect::<Option<Vec<u64>>>()?;
            Some((parts, entry.path().join("bin")))
        })
        .filter(|(_, bin)| bin.is_dir())
        .collect();
    dirs.sort();
    dirs.pop().map(|(_, bin)| bin)
}

/// Every well-known tool directory that exists on this machine.
fn gui_path_additions(home: Option<&std::path::Path>) -> Vec<std::path::PathBuf> {
    let mut dirs: Vec<std::path::PathBuf> = SYSTEM_BIN_DIRS
        .iter()
        .map(std::path::PathBuf::from)
        .collect();
    if let Some(home) = home {
        dirs.extend(HOME_BIN_DIRS.iter().map(|d| home.join(d)));
        dirs.extend(newest_nvm_bin(home));
    }
    dirs.retain(|d| d.is_dir());
    dirs
}

/// `current` with each of `extra` appended unless already present. Empty
/// entries are dropped: an empty PATH element means the working directory.
fn extended_path(
    current: &std::ffi::OsStr,
    extra: Vec<std::path::PathBuf>,
) -> Option<std::ffi::OsString> {
    let mut parts: Vec<std::path::PathBuf> = std::env::split_paths(current)
        .filter(|p| !p.as_os_str().is_empty())
        .collect();
    for dir in extra {
        if !parts.contains(&dir) {
            parts.push(dir);
        }
    }
    std::env::join_paths(parts).ok()
}

/// macOS GUI apps inherit launchd's bare PATH (/usr/bin:/bin:...), so direct
/// `Command::new("gh")` / `claude` spawns fail when Atlas is launched from
/// Finder/Dock rather than a terminal. Append the standard Homebrew and
/// user-level tool locations that exist. [UNVERIFIED on Windows]
fn extend_path_for_gui_launch() {
    let current = std::env::var_os("PATH").unwrap_or_default();
    let extra = gui_path_additions(dirs::home_dir().as_deref());
    if let Some(joined) = extended_path(&current, extra) {
        std::env::set_var("PATH", joined);
    }
}

pub fn run() -> std::process::ExitCode {
    setup_logging();
    install_panic_hook();
    log::info!("Atlas {} started", env!("CARGO_PKG_VERSION"));
    extend_path_for_gui_launch();

    let pty_manager = PtyManager::new();
    let lsp_manager = lsp::LspManager::new();
    let live_sessions = LiveSessionManager::new();
    let state_store = state::StateStore::new(dirs::home_dir().map(|h| h.join(".atlas")));

    let app = tauri::Builder::default()
        // Registered first, as the plugin requires. Two Atlas processes would
        // each hold their own copy of settings and workspaces and the last
        // writer would silently discard the other's changes, so a second
        // launch just brings the running window forward and exits.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        // macOS can swallow ⌘Escape inside the webview before it ever becomes a
        // JS keydown event (a known wry/WKWebView gap), so `backToSessions`
        // cannot rely on JS alone. A native menu accelerator is delivered by
        // AppKit before the webview sees the keypress, and — unlike a global
        // shortcut — only fires while Atlas is the frontmost app.
        .menu(|app_handle| {
            let menu = Menu::default(app_handle)?;
            let back_to_sessions = MenuItemBuilder::new("Back to Sessions")
                .id(BACK_TO_SESSIONS_MENU_ID)
                .accelerator("CmdOrCtrl+Escape")
                .build(app_handle)?;
            for item in menu.items()? {
                if item.id().0 == WINDOW_SUBMENU_ID {
                    if let Some(submenu) = item.as_submenu() {
                        submenu.append(&back_to_sessions)?;
                    }
                    break;
                }
            }
            Ok(menu)
        })
        .on_menu_event(|app, event| {
            if event.id().0 == BACK_TO_SESSIONS_MENU_ID {
                let _ = app.emit(BACK_TO_SESSIONS_MENU_ID, ());
            }
        })
        .manage(pty_manager)
        .manage(state_store)
        .manage(commands::files_scope::FilesScope::new(dirs::home_dir()))
        .manage(lsp_manager)
        .manage(live_sessions.clone())
        .manage(commands::files::DocsWatchers::default())
        .invoke_handler(tauri::generate_handler![
            state::state_load,
            state::state_save,
            claude_hook::set_claude_hook,
            commands::frontend_log::log_write,
            lsp::lsp_start,
            lsp::lsp_send,
            lsp::lsp_stop,
            commands::terminal::pty_spawn,
            commands::terminal::pty_write,
            commands::terminal::pty_resize,
            commands::terminal::pty_kill,
            commands::panel::get_panel_data,
            commands::panel::refresh_panel,
            commands::git::get_git_status,
            commands::git::git_checkout_branch,
            commands::git::list_workspace_repos,
            commands::prs::list_repo_prs,
            commands::prs::gh_viewer,
            commands::prs::gh_pr_checkout,
            commands::prs::open_url,
            commands::stats::get_claude_stats,
            commands::stats::list_resumable_sessions,
            commands::session::start_session_tail,
            commands::session::stop_session_tail,
            commands::session::start_omp_tail,
            commands::session::claude_info,
            commands::files::list_workspace_docs,
            commands::files::list_claude_plans,
            commands::files::list_dir,
            commands::files::read_text_file_at,
            commands::files::write_text_file_at,
            commands::files::validate_directory,
            commands::files_scope::files_grant,
            commands::files::start_docs_watch,
            commands::files::stop_docs_watch,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            match panel::watcher::start_watcher(handle) {
                Ok(watcher) => {
                    app.manage(watcher);
                }
                Err(e) => log::error!(
                    "Failed to start panel watcher: {} — panel updates will not work",
                    e
                ),
            }

            let stats_handle = app.handle().clone();
            match commands::stats::start_stats_watcher(stats_handle) {
                Ok(watcher) => {
                    app.manage(watcher);
                }
                Err(e) => log::warn!(
                    "Failed to start stats watcher: {} — live stats updates will not work",
                    e
                ),
            }

            // Separate from the stats watcher above: that one debounces a full
            // recompute at 1s, which the live session view must not wait on.
            let live_handle = app.handle().clone();
            match session::manager::start_live_watcher(live_handle, live_sessions) {
                Ok(watcher) => {
                    app.manage(watcher);
                }
                Err(e) => log::warn!(
                    "Failed to start live session watcher: {} — session updates will not work",
                    e
                ),
            }

            // Back-fill stats from all historical transcripts on launch (off the UI thread).
            let launch_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                match tokio::task::spawn_blocking(commands::stats::recompute).await {
                    Ok(Ok(summary)) => {
                        let _ = launch_handle.emit("stats-update", &summary);
                    }
                    Ok(Err(e)) => log::warn!("Initial stats recompute failed: {}", e),
                    Err(e) => log::warn!("Initial stats recompute task failed: {}", e),
                }
            });

            // Off by user choice in Settings › Claude Code; on when the setting
            // has never been written.
            let hook_enabled = app
                .state::<state::StateStore>()
                .read_json(state::StateFile::Settings)
                .and_then(|s| s.get("claudeHook").and_then(|v| v.as_bool()))
                .unwrap_or(true);
            claude_hook::sync_at_launch(hook_enabled);

            Ok(())
        })
        .build(tauri::generate_context!());
    let app = match app {
        Ok(app) => app,
        Err(e) => {
            log::error!("Tauri application error: {}", e);
            return std::process::ExitCode::FAILURE;
        }
    };
    app.run(|app, event| {
        // Nothing else stops the shells and language servers on quit:
        // background jobs survive the PTY hangup, and on Windows the
        // shell's children depend on ConPTY teardown.
        if let tauri::RunEvent::Exit = event {
            app.state::<PtyManager>().kill_all();
            app.state::<lsp::LspManager>().stop_all();
        }
    });
    std::process::ExitCode::SUCCESS
}

#[cfg(test)]
mod tests {
    use super::*;

    fn age(path: &std::path::Path, days: u64) {
        let when = std::time::SystemTime::now() - std::time::Duration::from_secs(days * 86_400);
        std::fs::File::options()
            .write(true)
            .open(path)
            .unwrap()
            .set_modified(when)
            .unwrap();
    }

    #[test]
    fn log_retention_prunes_only_old_atlas_logs() {
        let dir = tempfile::tempdir().unwrap();
        let old_log = dir.path().join("atlas-backend-2020-01-01.log");
        let recent_log = dir.path().join("atlas-backend-2099-01-01.log");
        let foreign = dir.path().join("notes.log");
        for f in [&old_log, &recent_log, &foreign] {
            std::fs::write(f, "x").unwrap();
        }
        age(&old_log, 20);
        age(&recent_log, 3);
        age(&foreign, 400);

        clean_old_logs(dir.path(), LOG_RETENTION_DAYS);

        assert!(!old_log.exists());
        assert!(recent_log.exists());
        assert!(foreign.exists(), "only atlas-*.log belongs to us");
    }

    struct CaptureLogger(std::sync::Mutex<Vec<String>>);
    impl log::Log for CaptureLogger {
        fn enabled(&self, _: &log::Metadata) -> bool {
            true
        }
        fn log(&self, record: &log::Record) {
            if record.level() == log::Level::Error {
                self.0.lock().unwrap().push(record.args().to_string());
            }
        }
        fn flush(&self) {}
    }

    #[test]
    fn a_panic_in_a_background_thread_is_logged_as_an_error() {
        static LOGGER: CaptureLogger = CaptureLogger(std::sync::Mutex::new(Vec::new()));
        log::set_logger(&LOGGER).unwrap();
        log::set_max_level(log::LevelFilter::Error);
        install_panic_hook();

        let _ = std::thread::Builder::new()
            .name("watcher-test".to_string())
            .spawn(|| panic!("boom 1234"))
            .unwrap()
            .join();
        let _ = std::panic::take_hook();

        let lines = LOGGER.0.lock().unwrap();
        assert!(
            lines
                .iter()
                .any(|l| l.contains("watcher-test") && l.contains("boom 1234")),
            "{lines:?}"
        );
    }

    #[test]
    fn an_empty_path_does_not_gain_a_working_directory_entry() {
        let joined = extended_path(std::ffi::OsStr::new(""), vec!["/x/bin".into()]).unwrap();
        let parts: Vec<_> = std::env::split_paths(&joined).collect();
        assert_eq!(parts, vec![std::path::PathBuf::from("/x/bin")]);
    }

    #[test]
    fn existing_path_entries_are_kept_first_and_not_duplicated() {
        let current = std::env::join_paths(["/usr/bin", "/x/bin"]).unwrap();
        let joined = extended_path(&current, vec!["/x/bin".into(), "/y/bin".into()]).unwrap();
        let parts: Vec<_> = std::env::split_paths(&joined).collect();
        assert_eq!(
            parts,
            vec![
                std::path::PathBuf::from("/usr/bin"),
                "/x/bin".into(),
                "/y/bin".into()
            ]
        );
    }

    #[test]
    fn user_level_tool_dirs_that_exist_are_added_and_missing_ones_are_not() {
        let home = tempfile::tempdir().unwrap();
        let local = home.path().join(".local/bin");
        std::fs::create_dir_all(&local).unwrap();
        for v in ["v18.19.0", "v20.11.1", "v9.0.0"] {
            std::fs::create_dir_all(home.path().join(".nvm/versions/node").join(v).join("bin"))
                .unwrap();
        }

        let added = gui_path_additions(Some(home.path()));

        assert!(added.contains(&local));
        assert!(!added.contains(&home.path().join(".volta/bin")));
        let nvm = home.path().join(".nvm/versions/node/v20.11.1/bin");
        assert!(
            added.contains(&nvm),
            "newest nvm node, not the newest string: {added:?}"
        );
        assert!(!added.contains(&home.path().join(".nvm/versions/node/v9.0.0/bin")));
    }
}
