import {idbRequest, withTransaction} from './draft-db.js';

export async function enqueueDraft(draftId) {
  return withTransaction(['drafts', 'outbox'], 'readwrite', async tx => {
    const drafts = tx.objectStore('drafts');
    let draft = await idbRequest(drafts.get(draftId));
    if (!draft) throw new Error('草稿不存在，無法準備送出');
    const timestamp = new Date().toISOString();
    if (draft.localState !== 'ready-to-send') {
      draft = {...draft, localState: 'ready-to-send', draftRevision: draft.draftRevision + 1, dirty: true, updatedAt: timestamp, lastLocalSavedAt: timestamp};
      await idbRequest(drafts.put(draft));
    }
    const outbox = tx.objectStore('outbox');
    const existing = await idbRequest(outbox.index('byDraftOperation').get([draftId, 'upsert']));
    const job = existing
      ? {...existing, payloadRevision: draft.draftRevision, status: 'queued', updatedAt: timestamp}
      : {jobId: crypto.randomUUID(), draftId, recordId: draft.recordId, operation: 'upsert', payloadRevision: draft.draftRevision, status: 'queued', createdAt: timestamp, updatedAt: timestamp};
    await idbRequest(outbox.put(job));
    return {draft, job};
  });
}

export async function listOutbox() {
  return withTransaction(['outbox'], 'readonly', tx => idbRequest(tx.objectStore('outbox').getAll()));
}

export async function removeOutbox(jobId) {
  return withTransaction(['outbox'], 'readwrite', tx => idbRequest(tx.objectStore('outbox').delete(jobId)));
}
