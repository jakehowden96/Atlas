//! Provider-neutral: spot a ticket id in a git branch name.

/// First `ABC-123` in `branch` (case-insensitive), upper-cased.
pub fn ticket_id_from_branch(branch: &str) -> Option<String> {
    let b = branch.as_bytes();
    for start in 0..b.len() {
        // The key must begin at a word boundary so `xENG-1` is not a hit on `ENG-1`.
        if start > 0 && b[start - 1].is_ascii_alphanumeric() {
            continue;
        }
        let letters = b[start..]
            .iter()
            .take_while(|c| c.is_ascii_alphabetic())
            .count();
        if letters == 0 || b.get(start + letters) != Some(&b'-') {
            continue;
        }
        let digits = b[start + letters + 1..]
            .iter()
            .take_while(|c| c.is_ascii_digit())
            .count();
        if digits > 0 {
            return Some(branch[start..start + letters + 1 + digits].to_ascii_uppercase());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::ticket_id_from_branch as f;

    #[test]
    fn finds_ids() {
        assert_eq!(f("jake/eng-482-fix-retry").as_deref(), Some("ENG-482"));
        assert_eq!(f("feature/ENG-482").as_deref(), Some("ENG-482"));
        assert_eq!(f("ENG-1").as_deref(), Some("ENG-1"));
    }

    #[test]
    fn no_match_and_first_wins() {
        assert_eq!(f("main"), None);
        assert_eq!(f("fix-retry-logic"), None);
        assert_eq!(f("eng-"), None);
        assert_eq!(f("abc-12-and-xyz-99").as_deref(), Some("ABC-12"));
    }
}
