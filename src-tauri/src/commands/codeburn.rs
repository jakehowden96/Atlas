//! Runs the user's installed `codeburn` CLI for the Stats screen.
//!
//! The frontend sends argv, so this is a trust boundary: only listed
//! subcommands run, and every argument is held to a strict character set
//! because on Windows the npm `.cmd` shim is executed through cmd.exe.

use std::io::Read;
use std::process::Stdio;
use std::time::{Duration, Instant};

use serde::Serialize;
use ts_rs::TS;

use super::session::{first_line, probe};
use crate::error::AtlasError;

const TOOL: &str = "codeburn";
const INSTALL_HINT: &str = "codeburn is not installed. Install it with: npm i -g codeburn";

/// Subcommands the read path may run. Each must be asked for JSON.
const READ_COMMANDS: &[&str] = &[
    "status",
    "report",
    "plan",
    "quota",
    "models",
    "sessions",
    "compare",
    "compare-periods",
    "yield",
    "spend",
    "optimize",
    "audit",
];

/// Commands that change something, each allowed by its leading arguments only.
const ACTION_PREFIXES: &[&[&str]] = &[
    &["optimize", "--apply"],
    &["act", "undo", "--last"],
    &["plan", "set"],
];

const RUN_TIMEOUT: Duration = Duration::from_secs(60);
const ACTION_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_STDOUT: u64 = 32 * 1024 * 1024;
const MAX_STDERR: u64 = 64 * 1024;

#[derive(Debug, Serialize, Default, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CodeburnInfo {
    /// Absolute path to the `codeburn` binary, if it is on PATH.
    pub binary: Option<String>,
    /// First line of `codeburn --version`.
    pub version: Option<String>,
}

fn arg_ok(arg: &str) -> bool {
    !arg.is_empty()
        && arg.len() <= 200
        && arg.chars().all(|c| {
            c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '/' | '@' | '=' | '-')
        })
}

fn validate_args(args: &[String]) -> Result<(), AtlasError> {
    if args.is_empty() {
        return Err(AtlasError::invalid_input("no codeburn command given"));
    }
    if let Some(bad) = args.iter().find(|a| !arg_ok(a)) {
        return Err(AtlasError::invalid_input(format!(
            "argument not allowed: {bad:?}"
        )));
    }
    Ok(())
}

fn validate_read(args: &[String]) -> Result<(), AtlasError> {
    validate_args(args)?;
    if !READ_COMMANDS.contains(&args[0].as_str()) {
        return Err(AtlasError::invalid_input(format!(
            "codeburn {} is not allowed here",
            args[0]
        )));
    }
    if args[0] == "plan" && args.iter().any(|a| a == "set") {
        return Err(AtlasError::invalid_input("plan set is an action, not a read"));
    }
    if args.iter().any(|a| a == "--apply") {
        return Err(AtlasError::invalid_input("--apply is not allowed here"));
    }
    if !args.iter().any(|a| a == "--format" || a == "--json") {
        return Err(AtlasError::invalid_input("a read needs --format or --json"));
    }
    Ok(())
}

fn validate_action(args: &[String]) -> Result<(), AtlasError> {
    validate_args(args)?;
    let allowed = ACTION_PREFIXES
        .iter()
        .any(|prefix| args.len() >= prefix.len() && args.iter().zip(*prefix).all(|(a, p)| a == p));
    if allowed {
        Ok(())
    } else {
        Err(AtlasError::invalid_input(format!(
            "codeburn {} is not an allowed action",
            args.join(" ")
        )))
    }
}

/// The runnable `codeburn`. On Windows `where` also lists npm's extensionless
/// shell shim, which cannot be spawned, so only exe/cmd/bat matches count.
fn which_codeburn() -> Option<String> {
    #[cfg(windows)]
    let lookup = "where";
    #[cfg(not(windows))]
    let lookup = "which";

    let mut command = probe(lookup);
    command.arg(TOOL);
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|line| {
            if !cfg!(windows) {
                return !line.is_empty();
            }
            let lower = line.to_ascii_lowercase();
            [".exe", ".cmd", ".bat"]
                .iter()
                .any(|ext| lower.ends_with(ext))
        })
        .map(str::to_string)
}

/// Read up to `cap` bytes, then keep draining so the child never blocks on a
/// full pipe. Bytes beyond the cap are dropped; the caller sees `len > cap`.
fn read_capped(mut reader: impl Read, cap: u64) -> Vec<u8> {
    let mut buf = Vec::new();
    let _ = (&mut reader).take(cap + 1).read_to_end(&mut buf);
    let _ = std::io::copy(&mut reader, &mut std::io::sink());
    buf
}

/// Run codeburn with `args`, returning stdout.
fn run(args: &[String], timeout: Duration) -> Result<Vec<u8>, AtlasError> {
    let binary = which_codeburn().ok_or_else(|| AtlasError::tool_missing(TOOL, INSTALL_HINT))?;
    let mut command = probe(&binary);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|e| AtlasError::tool_failed(TOOL, format!("could not start {binary}: {e}")))?;
    let stdout = child
        .stdout
        .take()
        .map(|s| std::thread::spawn(move || read_capped(s, MAX_STDOUT)));
    let stderr = child
        .stderr
        .take()
        .map(|s| std::thread::spawn(move || read_capped(s, MAX_STDERR)));

    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait().map_err(AtlasError::io)? {
            Some(status) => break status,
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(AtlasError::timeout(
                    TOOL,
                    format!(
                        "codeburn {} did not finish in {}s",
                        args[0],
                        timeout.as_secs()
                    ),
                ));
            }
            None => std::thread::sleep(Duration::from_millis(25)),
        }
    };

    let out = stdout.and_then(|t| t.join().ok()).unwrap_or_default();
    let err = stderr.and_then(|t| t.join().ok()).unwrap_or_default();
    if !status.success() {
        let message = String::from_utf8_lossy(&err)
            .lines()
            .map(str::trim)
            .find(|l| !l.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("codeburn {} exited with {status}", args[0]));
        return Err(AtlasError::tool_failed(TOOL, message));
    }
    if out.len() as u64 > MAX_STDOUT {
        return Err(AtlasError::tool_failed(TOOL, "output was too large"));
    }
    Ok(out)
}

/// Whether codeburn is installed, and which version.
#[tauri::command]
pub async fn codeburn_info() -> Result<CodeburnInfo, AtlasError> {
    Ok(tokio::task::spawn_blocking(|| {
        let binary = which_codeburn();
        let version = binary.as_deref().and_then(|b| {
            let mut command = probe(b);
            command.arg("--version");
            first_line(command)
        });
        CodeburnInfo { binary, version }
    })
    .await?)
}

/// Run a read-only codeburn command and return its JSON.
#[tauri::command]
pub async fn codeburn_run(args: Vec<String>) -> Result<serde_json::Value, AtlasError> {
    validate_read(&args)?;
    tokio::task::spawn_blocking(move || {
        let out = run(&args, RUN_TIMEOUT)?;
        serde_json::from_slice(&out).map_err(|e| {
            AtlasError::parse(format!("codeburn {} printed invalid JSON: {e}", args[0]))
        })
    })
    .await?
}

/// Run one of the few codeburn commands that change something; returns stdout.
#[tauri::command]
pub async fn codeburn_action(args: Vec<String>) -> Result<String, AtlasError> {
    validate_action(&args)?;
    tokio::task::spawn_blocking(move || {
        let out = run(&args, ACTION_TIMEOUT)?;
        Ok(String::from_utf8_lossy(&out).trim().to_string())
    })
    .await?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(args: &[&str]) -> Vec<String> {
        args.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn read_accepts_listed_json_commands() {
        assert!(validate_read(&v(&["status", "--format", "json", "--period", "today"])).is_ok());
        assert!(validate_read(&v(&[
            "compare-periods",
            "--format",
            "json",
            "--from-a",
            "2026-10-01"
        ]))
        .is_ok());
    }

    /// Needs `npm i -g codeburn`; run with `cargo test codeburn -- --ignored`.
    #[test]
    #[ignore]
    fn runs_the_installed_cli() {
        let args = v(&["status", "--format", "json", "--period", "today"]);
        validate_read(&args).unwrap();
        let out = run(&args, RUN_TIMEOUT).unwrap();
        serde_json::from_slice::<serde_json::Value>(&out).expect("valid JSON");
    }

    #[test]
    fn read_rejects_everything_else() {
        assert!(validate_read(&v(&[])).is_err());
        assert!(validate_read(&v(&["rm", "--format", "json"])).is_err());
        assert!(validate_read(&v(&["status"])).is_err(), "needs --format");
        assert!(validate_read(&v(&["optimize", "--apply", "--format", "json"])).is_err());
        assert!(validate_read(&v(&["status", "--format", "json&calc"])).is_err());
        assert!(validate_read(&v(&["status", "--format", "json", "a b"])).is_err());
        assert!(validate_read(&v(&["plan", "set", "claude-max", "--format", "json"])).is_err());
        assert!(validate_read(&v(&["status", "--format", ""])).is_err());
    }

    #[test]
    fn action_accepts_only_listed_prefixes() {
        assert!(validate_action(&v(&["optimize", "--apply"])).is_ok());
        assert!(validate_action(&v(&["act", "undo", "--last"])).is_ok());
        assert!(validate_action(&v(&["plan", "set", "claude-max"])).is_ok());
        assert!(validate_action(&v(&["plan"])).is_err());
        assert!(validate_action(&v(&["optimize"])).is_err());
        assert!(validate_action(&v(&["guard", "install"])).is_err());
        assert!(validate_action(&v(&["plan", "set", "x;y"])).is_err());
    }
}
