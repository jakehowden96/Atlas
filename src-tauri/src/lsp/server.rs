//! Which language server to run for a file, and where to find it.

use std::path::{Path, PathBuf};

/// A resolved language server: the binary, its arguments, and the LSP language
/// id the frontend should announce for the file.
#[derive(Debug, Clone, PartialEq)]
pub struct ServerSpec {
    pub command: PathBuf,
    pub args: Vec<String>,
}

/// The npm-installed servers, keyed by the LSP language ids they cover. These
/// are looked up inside the workspace first so a project gets diagnostics from
/// its own TypeScript rather than whichever version happens to be global.
const NODE_SERVERS: &[(&str, &str)] = &[
    ("typescript", "typescript-language-server"),
    ("typescriptreact", "typescript-language-server"),
    ("javascript", "typescript-language-server"),
    ("javascriptreact", "typescript-language-server"),
    ("svelte", "svelteserver"),
];

/// Servers that are normally installed as a plain executable on `PATH`.
const PATH_SERVERS: &[(&str, &str)] = &[
    ("rust", "rust-analyzer"),
    ("python", "pyright-langserver"),
    ("go", "gopls"),
];

/// The `--stdio` style flag each server needs to speak LSP over its pipes.
fn stdio_args(binary: &str) -> Vec<String> {
    match binary {
        "typescript-language-server" | "svelteserver" | "pyright-langserver" => {
            vec!["--stdio".to_string()]
        }
        // rust-analyzer and gopls speak LSP on stdio with no flag.
        _ => Vec::new(),
    }
}

/// Find the server for `language_id`, looking in the workspace before the
/// wider machine. Only called for a workspace the user turned language servers
/// on for (`lsp_start` checks), which is what makes running its
/// `node_modules/.bin` acceptable. Returns `None` when nothing suitable is installed, which is
/// not an error: the editor still highlights and edits, it just has no
/// diagnostics.
pub fn resolve(language_id: &str, workspace_root: &Path) -> Option<ServerSpec> {
    if let Some(binary) = lookup(NODE_SERVERS, language_id) {
        let found = in_node_modules(workspace_root, binary)
            .or_else(|| on_path(binary))
            .or_else(|| beside_atlas(binary));
        if let Some(command) = found {
            return Some(ServerSpec {
                command,
                args: stdio_args(binary),
            });
        }
    }
    if let Some(binary) = lookup(PATH_SERVERS, language_id) {
        if let Some(command) = on_path(binary) {
            return Some(ServerSpec {
                command,
                args: stdio_args(binary),
            });
        }
    }
    None
}

fn lookup(
    table: &'static [(&'static str, &'static str)],
    language_id: &str,
) -> Option<&'static str> {
    table
        .iter()
        .find(|(id, _)| *id == language_id)
        .map(|(_, binary)| *binary)
}

/// The file names a server binary may have on this platform. npm installs a
/// `.cmd` shim next to an extensionless sh script on Windows, and only the
/// `.cmd` can be launched there; native servers are `.exe`. [UNVERIFIED on
/// Windows]
fn executable_names(binary: &str, windows: bool) -> Vec<String> {
    if windows {
        vec![format!("{binary}.exe"), format!("{binary}.cmd")]
    } else {
        vec![binary.to_string()]
    }
}

/// The first existing file in `dir` named like `binary`.
fn find_in_dir(dir: &Path, binary: &str) -> Option<PathBuf> {
    executable_names(binary, cfg!(windows))
        .into_iter()
        .map(|name| dir.join(name))
        .find(|candidate| candidate.is_file())
}

/// `<root>/node_modules/.bin/<binary>`, and only there: a repository the user
/// merely opened must not get to run code from a directory it does not own, so
/// there is no walk up through the parents. The resolved file must also still
/// be inside `<root>/node_modules` once symlinks are followed, so a `.bin`
/// entry cannot point out of the tree.
fn in_node_modules(workspace_root: &Path, binary: &str) -> Option<PathBuf> {
    let modules = workspace_root.join("node_modules");
    let found = find_in_dir(&modules.join(".bin"), binary)?;
    let modules = modules.canonicalize().ok()?;
    found
        .canonicalize()
        .ok()
        .filter(|resolved| resolved.starts_with(&modules))
        .map(|_| found)
}

/// How far up from the executable to look for Atlas's own `node_modules`:
/// `target/{debug,release}/atlas` inside `src-tauri` inside the checkout.
const ATLAS_TREE_DEPTH: usize = 6;

/// Atlas's own `node_modules/.bin`, found by walking up from the executable.
///
/// Without this a workspace that has not installed a language server itself
/// gets no diagnostics at all, which for a personal tool is most of them. The
/// server Atlas ships is the last resort rather than the first, so a project
/// that pins its own TypeScript is still the one that reports on its code.
///
/// The walk is short and never reaches the filesystem root: `/node_modules`
/// or `C:\node_modules` is creatable by other users on some systems, and
/// nothing from there should run as this user.
fn beside_atlas(binary: &str) -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    exe.ancestors()
        .skip(1)
        .take(ATLAS_TREE_DEPTH)
        .filter(|dir| dir.parent().is_some())
        .find_map(|dir| find_in_dir(&dir.join("node_modules").join(".bin"), binary))
}

fn on_path(binary: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).find_map(|dir| find_in_dir(&dir, binary))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The file name the server has on this platform.
    fn server_file() -> String {
        executable_names("typescript-language-server", cfg!(windows)).remove(0)
    }

    #[test]
    fn prefers_the_workspace_copy_over_anything_on_path() {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("node_modules").join(".bin");
        std::fs::create_dir_all(&bin).unwrap();
        let server = bin.join(server_file());
        std::fs::write(&server, "#!/bin/sh\n").unwrap();

        let spec = resolve("typescript", dir.path()).expect("resolved");
        assert_eq!(spec.command, server);
        assert_eq!(spec.args, vec!["--stdio".to_string()]);
    }

    #[test]
    fn a_parent_directorys_node_modules_is_not_searched() {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("node_modules").join(".bin");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(bin.join(server_file()), "#!/bin/sh\n").unwrap();
        let nested = dir.path().join("packages").join("web");
        std::fs::create_dir_all(&nested).unwrap();

        assert_eq!(in_node_modules(&nested, "typescript-language-server"), None);
    }

    #[cfg(unix)]
    #[test]
    fn a_bin_entry_that_points_outside_node_modules_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let outside = dir.path().join("outside-server");
        std::fs::write(&outside, "#!/bin/sh\n").unwrap();
        let bin = dir.path().join("repo").join("node_modules").join(".bin");
        std::fs::create_dir_all(&bin).unwrap();
        std::os::unix::fs::symlink(&outside, bin.join("typescript-language-server")).unwrap();

        assert_eq!(
            in_node_modules(&dir.path().join("repo"), "typescript-language-server"),
            None
        );
    }

    #[test]
    fn windows_looks_for_launchable_extensions_not_the_sh_shim() {
        assert_eq!(
            executable_names("rust-analyzer", true),
            vec!["rust-analyzer.exe", "rust-analyzer.cmd"]
        );
        assert_eq!(
            executable_names("rust-analyzer", false),
            vec!["rust-analyzer"]
        );
    }

    #[test]
    fn a_language_with_no_server_installed_is_none_rather_than_an_error() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(resolve("cobol", dir.path()), None);
    }

    #[test]
    fn jsx_and_tsx_share_the_typescript_server() {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("node_modules").join(".bin");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(bin.join(server_file()), "#!/bin/sh\n").unwrap();
        for id in [
            "typescript",
            "typescriptreact",
            "javascript",
            "javascriptreact",
        ] {
            assert!(resolve(id, dir.path()).is_some(), "{id}");
        }
    }

    /* The fallback exists so a workspace that has installed nothing itself
    still gets diagnostics. It is last, so a project that pins its own
    TypeScript is the one that reports on its code. */
    #[test]
    fn falls_back_to_the_server_atlas_ships() {
        let empty = tempfile::tempdir().unwrap();
        // Nothing in the workspace and nothing named this on PATH, so anything
        // found came from beside the test binary — which is Atlas's own tree.
        let spec = resolve("typescript", empty.path());
        let shipped = beside_atlas("typescript-language-server");
        assert_eq!(
            spec.map(|s| s.command),
            shipped.or_else(|| on_path("typescript-language-server"))
        );
    }

    /* rust-analyzer takes no flag; handing it `--stdio` makes it exit. */
    #[test]
    fn only_the_servers_that_need_stdio_are_given_it() {
        assert!(stdio_args("rust-analyzer").is_empty());
        assert!(stdio_args("gopls").is_empty());
        assert_eq!(stdio_args("typescript-language-server"), vec!["--stdio"]);
    }
}
