use crate::error::AtlasError;

// --- Input validation ---

/// Session IDs are UUIDs or Atlas-generated tab ids and become directory names
/// and the `ATLAS_SESSION_ID` env value, so only plain ASCII is allowed: a
/// non-ASCII letter has composed and decomposed spellings that name different
/// directories on macOS.
pub(crate) fn validate_session_id(id: &str) -> Result<(), AtlasError> {
    const MAX_LEN: usize = 128;
    if id.is_empty() {
        return Err(AtlasError::invalid_input("Session ID cannot be empty"));
    }
    if id.len() > MAX_LEN {
        return Err(AtlasError::invalid_input(format!(
            "Session ID longer than {MAX_LEN} characters"
        )));
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(AtlasError::invalid_input(
            "Session ID contains invalid characters",
        ));
    }
    Ok(())
}

pub(crate) fn validate_cwd(cwd: &str) -> Result<(), AtlasError> {
    if cwd.is_empty() {
        return Err(AtlasError::invalid_input(
            "Working directory cannot be empty",
        ));
    }
    let path = std::path::Path::new(cwd);
    if !path.is_absolute() {
        return Err(AtlasError::invalid_input(
            "Working directory must be an absolute path",
        ));
    }
    if !path.is_dir() {
        return Err(AtlasError::not_found(format!(
            "Working directory does not exist: {cwd}"
        )));
    }
    Ok(())
}

pub(crate) fn validate_branch_name(branch: &str) -> Result<(), AtlasError> {
    if branch.is_empty() {
        return Err(AtlasError::invalid_input("Branch name cannot be empty"));
    }
    if branch.starts_with('-') {
        return Err(AtlasError::invalid_input(
            "Branch name cannot start with '-'",
        ));
    }
    if branch.contains("..") {
        return Err(AtlasError::invalid_input("Branch name cannot contain '..'"));
    }
    if branch.ends_with(".lock") {
        return Err(AtlasError::invalid_input(
            "Branch name cannot end with '.lock'",
        ));
    }
    let invalid_chars = [' ', '~', '^', ':', '?', '*', '[', '\\', '\x7f'];
    for ch in invalid_chars {
        if branch.contains(ch) {
            return Err(AtlasError::invalid_input(format!(
                "Branch name contains invalid character '{ch}'"
            )));
        }
    }
    if branch.bytes().any(|b| b < 0x20 || b == 0x7f) {
        return Err(AtlasError::invalid_input(
            "Branch name contains control characters",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- Input validation tests ---

    #[test]
    fn validate_session_id_accepts_valid_uuid() {
        assert!(validate_session_id("550e8400-e29b-41d4-a716-446655440000").is_ok());
    }

    #[test]
    fn validate_session_id_accepts_simple_id() {
        assert!(validate_session_id("my-session-123").is_ok());
    }

    #[test]
    fn validate_session_id_rejects_empty() {
        assert!(validate_session_id("").is_err());
    }

    #[test]
    fn validate_session_id_rejects_path_traversal() {
        assert!(validate_session_id("../../etc/passwd").is_err());
    }

    #[test]
    fn validate_session_id_rejects_slashes() {
        assert!(validate_session_id("abc/def").is_err());
        assert!(validate_session_id("abc\\def").is_err());
    }

    #[test]
    fn validate_session_id_rejects_special_chars() {
        assert!(validate_session_id("abc def").is_err());
        assert!(validate_session_id("abc!def").is_err());
    }

    #[test]
    fn validate_session_id_rejects_non_ascii_and_overlong() {
        assert!(validate_session_id("é").is_err());
        assert!(validate_session_id(&"a".repeat(129)).is_err());
        assert!(validate_session_id(&"a".repeat(128)).is_ok());
    }

    #[test]
    fn validate_cwd_rejects_empty() {
        assert!(validate_cwd("").is_err());
    }

    #[test]
    fn validate_cwd_rejects_relative_path() {
        assert!(validate_cwd("relative/path").is_err());
    }

    #[test]
    fn validate_cwd_rejects_nonexistent_path() {
        assert!(validate_cwd("/nonexistent/path/should/not/exist").is_err());
    }

    #[test]
    fn validate_cwd_accepts_existing_dir() {
        let tmp = std::env::temp_dir();
        assert!(validate_cwd(tmp.to_str().unwrap()).is_ok());
    }

    #[test]
    fn validate_branch_name_accepts_valid() {
        assert!(validate_branch_name("feature/my-branch").is_ok());
        assert!(validate_branch_name("main").is_ok());
        assert!(validate_branch_name("fix-123").is_ok());
        assert!(validate_branch_name("release/v1.0").is_ok());
    }

    #[test]
    fn validate_branch_name_rejects_empty() {
        assert!(validate_branch_name("").is_err());
    }

    #[test]
    fn validate_branch_name_rejects_double_dot() {
        assert!(validate_branch_name("branch..name").is_err());
    }

    #[test]
    fn validate_branch_name_rejects_leading_dash() {
        assert!(validate_branch_name("-bad-name").is_err());
    }

    #[test]
    fn validate_branch_name_rejects_space() {
        assert!(validate_branch_name("bad name").is_err());
    }

    #[test]
    fn validate_branch_name_rejects_tilde() {
        assert!(validate_branch_name("bad~name").is_err());
    }

    #[test]
    fn validate_branch_name_rejects_lock_suffix() {
        assert!(validate_branch_name("refs/heads/main.lock").is_err());
    }

    #[test]
    fn validate_branch_name_rejects_del_character() {
        assert!(validate_branch_name("bad\x7fname").is_err());
    }

    #[test]
    fn validate_branch_name_rejects_control_chars() {
        assert!(validate_branch_name("bad\x01name").is_err());
        assert!(validate_branch_name("bad\tname").is_err());
    }
}
