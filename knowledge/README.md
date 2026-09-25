# Phase 16 Knowledge Integration

The existing `?open=knowledge` workspace combines two sources without migrating either one:

- `LocalKnowledgeAdapter` reads the existing `lizhi-local-cloud` IndexedDB records through the current application state.
- `VaultKnowledgeAdapter` reads the Phase 15 Obsidian Web Sync HTTP API. It never sends write requests.
- `KnowledgeService` keeps failures isolated so local notes, folders, and documents remain available while the Vault service is offline.

The Vault endpoint defaults to `http://127.0.0.1:8000` only on the local site. It is disabled on GitHub Pages because a remote HTTPS page must not assume access to a user's localhost service.

Phase 16 is deliberately read-only for Vault content. Creating or editing Vault notes remains governed by Obsidian Web Sync's Write Request → Sync Agent → VaultWriter path.
