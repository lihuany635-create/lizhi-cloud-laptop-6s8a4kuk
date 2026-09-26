import {idbRequest, withTransaction} from './draft-db.js';
import {getTemplate} from './template-registry.js';
import {validateFields} from './template-values.js';
import {snapshotPayload, validateQueuePayload} from './resource-model.js';

export async function enqueueDraft(draftId) {
  return withTransaction(['drafts', 'outbox'], 'readwrite', async tx => {
    const drafts = tx.objectStore('drafts');
    let draft = await idbRequest(drafts.get(draftId));
    if (!draft) throw new Error('草稿不存在，無法準備送出');
    if (draft.templateId) {
      const template = getTemplate(draft.templateId, draft.templateVersion);
      if (!template) throw new Error('找不到這份草稿使用的模板版本，無法準備送出');
      const validation = validateFields(template, draft.fields);
      if (!validation.valid) {
        const error = new Error('請先完成或確認模板欄位');
        error.fieldErrors = validation.errors;
        throw error;
      }
    }
    const resourceValidation = validateQueuePayload(draft);
    if (!resourceValidation.valid) {
      const error = new Error(resourceValidation.templateMissing ? '找不到模板版本' : !resourceValidation.relationsValid ? '筆記關聯無效' : '請先確認外部網址');
      error.linkErrors = resourceValidation.linkErrors;
      error.fieldErrors = resourceValidation.fieldErrors;
      throw error;
    }
    const timestamp = new Date().toISOString();
    if (draft.localState !== 'ready-to-send') {
      draft = {...draft, localState: 'ready-to-send', draftRevision: draft.draftRevision + 1, dirty: true, updatedAt: timestamp, lastLocalSavedAt: timestamp};
      await idbRequest(drafts.put(draft));
    }
    const outbox = tx.objectStore('outbox');
    const existing = await idbRequest(outbox.index('byDraftOperation').get([draftId, 'upsert']));
    const job = existing
      ? {...existing, payloadRevision: draft.draftRevision, remoteRevision: draft.remoteRevision || 0, templateId: draft.templateId || null, templateVersion: draft.templateVersion || null, payload: snapshotPayload(draft), status: 'queued', updatedAt: timestamp}
      : {jobId: crypto.randomUUID(), draftId, recordId: draft.recordId, remoteRevision: draft.remoteRevision || 0, operation: 'upsert', payloadRevision: draft.draftRevision, templateId: draft.templateId || null, templateVersion: draft.templateVersion || null, payload: snapshotPayload(draft), status: 'queued', createdAt: timestamp, updatedAt: timestamp};
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

export async function claimOutbox(jobId) {
  return withTransaction(['outbox'], 'readwrite', async tx => {
    const store = tx.objectStore('outbox');
    const job = await idbRequest(store.get(jobId));
    if (!job || !['queued', 'retry'].includes(job.status)) return null;
    if (job.nextRetryAt && Date.parse(job.nextRetryAt) > Date.now()) return null;
    const claimId = crypto.randomUUID();
    const claimed = {...job, status: 'sending', claimId, leaseUntil: new Date(Date.now() + 60_000).toISOString(), updatedAt: new Date().toISOString()};
    await idbRequest(store.put(claimed));
    return claimed;
  });
}

export async function recoverExpiredOutbox() {
  return withTransaction(['outbox'], 'readwrite', async tx => {
    const store = tx.objectStore('outbox');
    const jobs = await idbRequest(store.getAll());
    for (const job of jobs) if (job.status === 'sending' && Date.parse(job.leaseUntil || '') < Date.now()) {
      await idbRequest(store.put({...job, status: 'retry', claimId: null, leaseUntil: null, updatedAt: new Date().toISOString()}));
    }
  });
}

export async function finishOutbox(jobId, claimId, payloadRevision, result) {
  return withTransaction(['drafts', 'outbox'], 'readwrite', async tx => {
    const outbox = tx.objectStore('outbox');
    const job = await idbRequest(outbox.get(jobId));
    if (!job || job.claimId !== claimId) return false;
    const drafts = tx.objectStore('drafts');
    const draft = await idbRequest(drafts.get(job.draftId));
    if (draft) await idbRequest(drafts.put({...draft, recordId: result.record.id, remoteRevision: result.record.revision,
      lastSyncedAt: new Date().toISOString(), dirty: draft.draftRevision !== payloadRevision}));
    const unchanged = job.payloadRevision === payloadRevision;
    await idbRequest(outbox.put({...job, status: unchanged ? 'synced' : 'queued', claimId: null, leaseUntil: null,
      remoteRevision: result.record.revision, lastError: null, updatedAt: new Date().toISOString()}));
    return true;
  });
}

export async function failOutbox(jobId, claimId, status, message) {
  return withTransaction(['outbox'], 'readwrite', async tx => {
    const store = tx.objectStore('outbox');
    const job = await idbRequest(store.get(jobId));
    if (!job || job.claimId !== claimId) return false;
    const attempts = (job.attempts || 0) + 1;
    const retry = status === 'retry';
    await idbRequest(store.put({...job, status, claimId: null, leaseUntil: null, attempts,
      nextRetryAt: retry ? new Date(Date.now() + Math.min(15 * 60_000, 2 ** Math.min(attempts, 8) * 1000)).toISOString() : null,
      lastError: message, updatedAt: new Date().toISOString()}));
    return true;
  });
}
