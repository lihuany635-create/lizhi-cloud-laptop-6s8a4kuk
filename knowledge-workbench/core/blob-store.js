import {idbRequest, withTransaction} from './draft-db.js';

export async function addBlob(draftId, file) {
  if (!(file instanceof Blob)) throw new TypeError('附件必須是 Blob 或 File');
  return withTransaction(['drafts', 'blobs', 'outbox'], 'readwrite', async tx => {
    const drafts = tx.objectStore('drafts');
    const draft = await idbRequest(drafts.get(draftId));
    if (!draft) throw new Error('草稿不存在，無法暫存附件');
    const blobId = crypto.randomUUID();
    const timestamp = new Date().toISOString();
    const metadata = {blobId, name: file.name || 'attachment', mimeType: file.type || 'application/octet-stream', size: file.size};
    await idbRequest(tx.objectStore('blobs').add({blobId, draftId, ...metadata, blob: file, createdAt: timestamp}));
    const saved = {...draft, attachments: [...draft.attachments, metadata], draftRevision: draft.draftRevision + 1, dirty: true, updatedAt: timestamp, lastLocalSavedAt: timestamp};
    await idbRequest(drafts.put(saved));
    const outbox = tx.objectStore('outbox');
    const job = await idbRequest(outbox.index('byDraftOperation').get([draftId, 'upsert']));
    if (job) await idbRequest(outbox.put({...job, payloadRevision: saved.draftRevision, updatedAt: timestamp}));
    return {draft: saved, attachment: metadata};
  });
}

export async function getBlob(blobId) {
  return withTransaction(['blobs'], 'readonly', tx => idbRequest(tx.objectStore('blobs').get(blobId)));
}

export async function listBlobs(draftId) {
  return withTransaction(['blobs'], 'readonly', tx => idbRequest(tx.objectStore('blobs').index('byDraftId').getAll(draftId)));
}
