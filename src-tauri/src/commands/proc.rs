use std::process::Command;

/// Keep a spawned child from flashing a console window.
///
/// The release build is a GUI-subsystem process, so on Windows every child
/// console program (git, gh, language servers) otherwise gets its own visible
/// console. No-op elsewhere.
// `cmd` is only touched on Windows; other platforms have no console to hide.
#[cfg_attr(not(windows), allow(unused_variables))]
pub(crate) fn no_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
}
