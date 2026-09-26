# Phase 3 Local Draft Contract V1

This module is an isolated, reusable browser-local staging layer for the new Knowledge Workbench. It is **not** the formal cross-device knowledge store. GitHub `knowledge-data` remains the future formal store; Phase 3 does not write to GitHub, Obsidian, or Markdown files.

## Database

IndexedDB name: `lizhi-knowledge-workbench`; version: `1`.

| Store | keyPath | Purpose |
| --- | --- | --- |
| `drafts` | `draftId` | Draft V1 content and field values |
| `blobs` | `blobId` | Attachment `Blob` objects, indexed by `draftId` |
| `outbox` | `jobId` | Local `queued` work only, unique by `(draftId, operation)` |
| `meta` | `key` | Local schema metadata |

The database is separate from `lizhi-local-cloud`, `lizhi-finance`, and other existing browser data. There is no migration or deletion of those databases. Future schema changes must increment the IndexedDB version and preserve existing stores and records in `onupgradeneeded`; do not silently recreate the database.

## Draft V1

Each draft contains `schemaVersion: 1`, permanent local UUID `draftId`, nullable formal `recordId`, positive `draftRevision`, `title`, logical `folderPath`, `templateId`, `templateVersion`, generic `fields`, `tags`, `relations`, `links`, attachment metadata, `localState`, `dirty`, and UTC ISO-8601 `createdAt`, `updatedAt`, `lastLocalSavedAt`.

- `draftId` does not change when title or folder changes. `recordId` remains null in Phase 3.
- `draftRevision` increments for each successful local content save, attachment addition, or first transition to `ready-to-send`.
- `localState` is `draft` or `ready-to-send`. `dirty` remains `true` until a future central writer confirms formal persistence; local autosave never marks a draft centrally clean.
- Attachments in `drafts` are metadata (`blobId`, name, MIME type, size); the actual Blob stays in `blobs`.
- The controller debounces input by 800 ms, flushes on blur and when the document becomes hidden, and attempts an IndexedDB flush on `pagehide`. A browser may terminate before an asynchronous `pagehide` transaction commits; the last **confirmed** local save is the recovery point.
- A stale edit from another tab is rejected when its `draftRevision` no longer matches the stored revision. The UI must display the save failure and retain the current unsaved text rather than silently overwriting.

## Outbox V1

`jobId` is a UUID. A job has `draftId`, nullable `recordId`, `operation: "upsert"`, `payloadRevision`, `status: "queued"`, `createdAt`, and `updatedAt`. `enqueueDraft` creates or updates the one job for `(draftId, upsert)`. Subsequent local edits advance `payloadRevision` in the same IndexedDB transaction as the draft save. There is no sender or network POST in Phase 3. `queued` means **待正式送出**, not uploaded.

Deleting a draft deletes the draft, its Blob records, and its outbox jobs in one transaction. The deletion is only triggered by an explicit user action with confirmation in the harness.

## Integration and offline boundary

The independent harness is at `/knowledge-workbench/dev/phase3-draft-harness.html`. It is not linked from the main navigation and does not register a Service Worker. Once loaded, editing and IndexedDB saves continue while network connectivity is unavailable. Reloading the page from the network after the browser is closed and offline is **not** promised. Phase 4 can import `DraftController` into a formal UI without replacing the storage layer.

No GitHub token, PAT, authorization header, or write endpoint belongs in this module. Its UI may say “本機草稿已儲存” or “待正式送出”; it must not say “已同步” or imply cross-device persistence.
