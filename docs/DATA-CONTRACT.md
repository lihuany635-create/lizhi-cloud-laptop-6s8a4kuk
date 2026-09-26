# Lizhi Knowledge Data Contract V1

This branch is the public, shared data layer for the new Knowledge Workbench. It is separate from the website application on `main` and from the existing `obsidian-web-sync` project. Phase 2 defines the storage contract only; it does not connect an editor, gateway, template engine, or Obsidian bridge.

## Layout

- `manifest.json`: schema version, branch identity, data revision, and paths to indexes.
- `indexes/records.json`: active-record index; initially empty.
- `indexes/trash.json`: trashed-record index; initially empty.
- `records/<UUID>.json`: one formal knowledge record per permanent UUID.
- `templates/index.json`: template catalog; initially empty.
- `assets/<record UUID>/...`: future managed attachments and images.
- `state/obsidian-backup.json`: future backup status, separate from content revisions.
- `examples/record-v1.json`: non-production format example; it is not indexed as a formal record.

## Record V1

Every formal record has `schemaVersion: 1`, a permanent UUID `id`, a positive integer `revision`, `title`, `folderPath`, `templateId`, `templateVersion`, `status`, `fields`, `tags`, `relations`, `links`, `attachments`, `createdAt`, `updatedAt`, and nullable `deletedAt`. Timestamps are UTC ISO 8601 strings.

- `id` is immutable. Rename or moving a record changes `title` or `folderPath`, not `id`.
- `folderPath` is a logical website folder path, not a Markdown file path. Do not use absolute paths or `..` components.
- `revision` tracks user-visible content changes and increases monotonically. Future writers must compare the expected revision before replacing a record to prevent concurrent edits from silently overwriting each other.
- `relations` refer to other records by `targetId` (UUID), never by title or filename. A relation may carry a type or label, but `targetId` is its stable key.
- `links` hold external URLs as structured data. `attachments` hold system-managed asset metadata and paths; users should not have to hand-write WikiLinks or asset paths.
- `status: "trashed"` or non-null `deletedAt` means soft deletion. Move the record reference from the active index to the trash index; do not permanently delete it as part of a normal edit.
- `templateId` and `templateVersion` reserve a stable template reference. Phase 2 does not define or execute templates.

The active and trash indexes are discovery aids. The record JSON is the formal content. When a future writer changes content, it must update the record and relevant index consistently and increment the appropriate revisions and `manifest.dataRevision`.

## Obsidian and security boundary

For this **new Knowledge Workbench**, `knowledge-data` is the planned website source of truth. A future Windows bridge may generate `.md`, images, and WikiLinks as a one-way local backup to Obsidian. Obsidian must not reverse-overwrite these website records. This rule does **not** modify or replace the separate, existing `obsidian-web-sync` bidirectional system.

Backup status belongs in `state/obsidian-backup.json` (for example, `backedUpRevision`, `status`, `lastBackupAt` keyed by record UUID). A backup status update must not increment the formal record content `revision`.

This branch is public and readable through Raw GitHub. Do not commit passwords, tokens, private credentials, or sensitive knowledge. GitHub write credentials must never be placed in JSON, GitHub Pages HTML/JavaScript, or other public repository content. A future safe write service or gateway is required before website editing can write formal records.
