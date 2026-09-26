import {idbRequest, withTransaction} from './draft-db.js';
import {updateQueuedJob} from './resource-model.js';

const now = () => new Date().toISOString();

export function newDraft() {
  const timestamp = now();
  return {
    schemaVersion: 1, draftId: crypto.randomUUID(), recordId: null, draftRevision: 1,
    title: '', folderPath: '', templateId: '', templateVersion: 1,
    fields: {}, tags: [], relations: [], links: [], images: [], attachments: [],
    localState: 'draft', dirty: true,
    createdAt: timestamp, updatedAt: timestamp, lastLocalSavedAt: timestamp,
  };
}

export async function createDraft() {
  const draft = newDraft();
  await withTransaction(['drafts'], 'readwrite', tx => idbRequest(tx.objectStore('drafts').add(draft)));
  return draft;
}

export async function importRemoteRecord(record) {
  if (record.status !== 'active' || !record.id || !Number.isSafeInteger(record.revision)) throw new Error('正式知識資料無效');
  return withTransaction(['drafts'], 'readwrite', async tx => {
    const store = tx.objectStore('drafts');
    const existing = await idbRequest(store.get(record.id));
    if (existing) return {draft: existing, existing: true};
    const timestamp = now();
    const draft = {schemaVersion: 1, draftId: record.id, recordId: record.id, remoteRevision: record.revision,
      draftRevision: 1, title: record.title, folderPath: record.folderPath, templateId: record.templateId,
      templateVersion: record.templateVersion, fields: structuredClone(record.fields), tags: structuredClone(record.tags || []),
      relations: structuredClone(record.relations || []), links: structuredClone(record.links || []),
      images: structuredClone(record.images || []), attachments: structuredClone(record.attachments || []),
      localState: 'draft', dirty: false, createdAt: timestamp, updatedAt: timestamp, lastLocalSavedAt: timestamp, lastSyncedAt: timestamp};
    await idbRequest(store.add(draft));
    return {draft, existing: false};
  });
}

export async function getDraft(draftId) {
  return withTransaction(['drafts'], 'readonly', tx => idbRequest(tx.objectStore('drafts').get(draftId)));
}

export async function listDrafts() {
  const rows = await withTransaction(['drafts'], 'readonly', tx => idbRequest(tx.objectStore('drafts').getAll()));
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function saveDraft(snapshot) {
  return withTransaction(['drafts', 'outbox'], 'readwrite', async tx => {
    const drafts = tx.objectStore('drafts');
    const existing = await idbRequest(drafts.get(snapshot.draftId));
    if (!existing) throw new Error('草稿不存在，無法自動儲存');
    if (existing.draftRevision !== snapshot.draftRevision) throw new Error('此草稿已在另一分頁變更；請重新開啟以免覆蓋');
    const timestamp = now();
    const saved = {
      ...existing, ...snapshot, draftId: existing.draftId, recordId: existing.recordId,
      schemaVersion: 1, draftRevision: existing.draftRevision + 1,
      dirty: true, createdAt: existing.createdAt,
      updatedAt: timestamp, lastLocalSavedAt: timestamp,
    };
    await idbRequest(drafts.put(saved));
    const outbox = tx.objectStore('outbox');
    const job = await idbRequest(outbox.index('byDraftOperation').get([saved.draftId, 'upsert']));
    if (job) await idbRequest(outbox.put(updateQueuedJob(job, saved, timestamp)));
    return saved;
  });
}

export async function deleteDraft(draftId) {
  return withTransaction(['drafts', 'blobs', 'outbox'], 'readwrite', async tx => {
    await idbRequest(tx.objectStore('drafts').delete(draftId));
    for (const name of ['blobs', 'outbox']) {
      const store = tx.objectStore(name);
      const index = store.index(name === 'blobs' ? 'byDraftId' : 'byDraftOperation');
      const range = name === 'blobs' ? IDBKeyRange.only(draftId) : IDBKeyRange.bound([draftId, ''], [draftId, '\uffff']);
      const keys = await idbRequest(index.getAllKeys(range));
      for (const key of keys) await idbRequest(store.delete(key));
    }
  });
}
