//! PKCE verifier, S256 challenge and `state`. Never log these.

use oauth2::{CsrfToken, PkceCodeChallenge};

pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
    pub state: String,
}

impl Pkce {
    pub fn generate() -> Self {
        let (challenge, verifier) = PkceCodeChallenge::new_random_sha256();
        Self {
            verifier: verifier.secret().clone(),
            challenge: challenge.as_str().to_string(),
            state: CsrfToken::new_random().secret().clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn values_are_fresh_and_challenge_is_s256_length() {
        let (a, b) = (Pkce::generate(), Pkce::generate());
        assert_ne!(a.state, b.state);
        assert_ne!(a.verifier, b.verifier);
        assert_eq!(a.challenge.len(), 43); // base64url of a SHA-256 digest
    }
}
