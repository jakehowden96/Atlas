// --- Input validation ---

pub(crate) fn validate_session_id(id: &str) -> Result<(), String> {
    if id.is_empty() {
        return Err("Session ID cannot be empty".to_string());
    }
    if id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err("Session ID contains invalid characters".to_string());
    }
    // Allow UUID format and simple alphanumeric-hyphen IDs
    if !id.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
        return Err("Session ID contains invalid characters".to_string());
    }
    Ok(())
}

pub(crate) fn validate_cwd(cwd: &str) -> Result<(), String> {
    if cwd.is_empty() {
        return Err("Working directory cannot be empty".to_string());
    }
    let path = std::path::Path::new(cwd);
    if !path.is_absolute() {
        return Err("Working directory must be an absolute path".to_string());
    }
    if !path.is_dir() {
        return Err(format!("Working directory does not exist: {}", cwd));
    }
    Ok(())
}

pub(crate) fn validate_branch_name(branch: &str) -> Result<(), String> {
    if branch.is_empty() {
        return Err("Branch name cannot be empty".to_string());
    }
    if branch.starts_with('-') {
        return Err("Branch name cannot start with '-'".to_string());
    }
    if branch.contains("..") {
        return Err("Branch name cannot contain '..'".to_string());
    }
    if branch.ends_with(".lock") {
        return Err("Branch name cannot end with '.lock'".to_string());
    }
    let invalid_chars = [' ', '~', '^', ':', '?', '*', '[', '\\', '\x7f'];
    for ch in invalid_chars {
        if branch.contains(ch) {
            return Err(format!("Branch name contains invalid character '{}'", ch));
        }
    }
    if branch.bytes().any(|b| b < 0x20 || b == 0x7f) {
        return Err("Branch name contains control characters".to_string());
    }
    Ok(())
}

pub(crate) fn validate_file_paths(cwd: &str, files: &[String]) -> Result<(), String> {
    let base = match std::fs::canonicalize(cwd) {
        Ok(p) => p,
        Err(_) => return Err(format!("Cannot resolve working directory: {}", cwd)),
    };
    for file in files {
        if file.is_empty() {
            return Err("File path cannot be empty".to_string());
        }
        if std::path::Path::new(file).is_absolute() {
            return Err(format!("File path must be relative: {}", file));
        }
        // Reject any path containing .. components to prevent traversal
        if file.split('/').any(|c| c == "..") || file.split('\\').any(|c| c == "..") {
            return Err(format!("File path contains '..': {}", file));
        }
        let resolved = base.join(file);
        let normalized = resolved.to_string_lossy();
        let base_str = base.to_string_lossy();
        if !normalized.starts_with(base_str.as_ref()) {
            return Err(format!("File path escapes repository: {}", file));
        }
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
    fn validate_file_paths_rejects_absolute_path() {
        assert!(validate_file_paths("/tmp", &["/etc/passwd".to_string()]).is_err());
    }

    #[test]
    fn validate_file_paths_rejects_traversal() {
        assert!(validate_file_paths("/tmp", &["../../etc/passwd".to_string()]).is_err());
    }

    #[test]
    fn validate_file_paths_accepts_relative() {
        let tmp = std::env::temp_dir();
        assert!(
            validate_file_paths(tmp.to_str().unwrap(), &["subdir/file.txt".to_string()]).is_ok()
        );
    }

    #[test]
    fn validate_file_paths_rejects_empty() {
        assert!(validate_file_paths("/tmp", &["".to_string()]).is_err());
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
