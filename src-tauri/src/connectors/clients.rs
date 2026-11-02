//! One public OAuth client id per provider. `REPLACE_ME` marks an app the
//! user has not registered yet.

pub const PLACEHOLDER: &str = "REPLACE_ME";

pub const LINEAR_CLIENT_ID: &str = PLACEHOLDER;
/// Loopback ports for the Linear browser flow: primary, then two fallbacks.
pub const LINEAR_REDIRECT_PORTS: [u16; 3] = [53682, 53683, 53684];
pub const GITHUB_CLIENT_ID: &str = PLACEHOLDER;

pub fn is_configured(client_id: &str) -> bool {
    !client_id.is_empty() && client_id != PLACEHOLDER
}
