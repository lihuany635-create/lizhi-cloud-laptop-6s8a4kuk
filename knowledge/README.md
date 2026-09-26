# Phase 16 Knowledge Integration

The existing `?open=knowledge` workspace combines two sources without migrating either one:

- `LocalKnowledgeAdapter` reads the existing `lizhi-local-cloud` IndexedDB records through the current application state.
- `VaultKnowledgeAdapter` reads the Phase 15 Obsidian Web Sync HTTP API. It never sends write requests.
- `KnowledgeService` keeps failures isolated so local notes, folders, and documents remain available while the Vault service is offline.

The Vault endpoint defaults to `http://127.0.0.1:8000` only on the local site. It is disabled on GitHub Pages because a remote HTTPS page must not assume access to a user's localhost service.

Phase 16 introduced read-only Vault content. Creating or editing Vault notes is governed by Obsidian Web Sync's Write Request → Sync Agent → VaultWriter path.

## Phase 17 editor

The unified editor creates a temporary `Knowledge Draft`, validates it, and produces deterministic Markdown through `KnowledgeSerializer`. General notes, regulations, quality checks, experience records, problem/solution records, custom knowledge, and the existing Phase 13 workflow serializer share the same entry point.

Vault creates and updates call only `/api/write-requests`; updates carry the `contentHash` as `baseHash`. The editor waits for `applied`, then waits for the mirror to return a new hash before closing. Conflict, failure, timeout, and offline states retain the draft. Session storage is recovery-only and never becomes a source of truth.
