//! One public OAuth client id per provider. `REPLACE_ME` marks an app the
//! user has not registered yet.

pub const PLACEHOLDER: &str = "REPLACE_ME";

#[allow(dead_code)] // read by the provider modules added in later phases
pub const LINEAR_CLIENT_ID: &str = PLACEHOLDER;
#[allow(dead_code)]
pub const GITHUB_CLIENT_ID: &str = PLACEHOLDER;

pub fn is_configured(client_id: &str) -> bool {
    !client_id.is_empty() && client_id != PLACEHOLDER
}
