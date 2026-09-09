#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::ExitCode;

fn main() -> ExitCode {
    // `atlas hook <kind>` is the Claude Code hook entry point: it reads stdin,
    // does its work and exits without ever starting Tauri.
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() == Some("hook") {
        return atlas_lib::hook::run_hook(args.next().unwrap_or_default().as_str());
    }

    atlas_lib::run();
    ExitCode::SUCCESS
}
