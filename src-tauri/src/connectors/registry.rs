//! Providers by id.

use std::collections::BTreeMap;
use std::sync::Arc;

use super::provider::ConnectorProvider;

#[derive(Default)]
pub struct Registry {
    providers: BTreeMap<String, Arc<dyn ConnectorProvider>>,
}

impl Registry {
    /// The providers that ship with Atlas.
    pub fn builtin() -> Self {
        let mut registry = Self::default();
        registry.register(Arc::new(super::github::GithubProvider::default()));
        registry.register(Arc::new(super::linear::LinearProvider::default()));
        registry
    }

    pub fn register(&mut self, provider: Arc<dyn ConnectorProvider>) {
        self.providers.insert(provider.info().id, provider);
    }

    pub fn get(&self, id: &str) -> Option<&Arc<dyn ConnectorProvider>> {
        self.providers.get(id)
    }

    pub fn all(&self) -> impl Iterator<Item = &Arc<dyn ConnectorProvider>> {
        self.providers.values()
    }
}
