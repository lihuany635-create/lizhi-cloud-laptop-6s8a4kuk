import {idbRequest, withTransaction} from './draft-db.js';
import {updateQueuedJob} from './resource-model.js';

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
    if (job) await idbRequest(outbox.put(updateQueuedJob(job, saved, timestamp)));
    return {draft: saved, attachment: metadata};
  });
}

export async function addResource(draftId, file, kind, expectedRevision) {
  if (!(file instanceof Blob) || !['image', 'file'].includes(kind)) throw new TypeError('資源必須是圖片或附件 Blob');
  if (kind === 'image' && !file.type.startsWith('image/')) throw new TypeError('請選擇圖片檔案');
  return withTransaction(['drafts', 'blobs', 'outbox'], 'readwrite', async tx => {
    const drafts = tx.objectStore('drafts');
    const draft = await idbRequest(drafts.get(draftId));
    if (!draft) throw new Error('草稿不存在，無法暫存資源');
    if (expectedRevision !== undefined && draft.draftRevision !== expectedRevision) throw new Error('此草稿已在另一分頁變更；請重新開啟以免覆蓋');
    const timestamp = new Date().toISOString();
    const blobId = crypto.randomUUID();
    const asset = {assetId: crypto.randomUUID(), blobId, kind, originalName: file.name || (kind === 'image' ? 'image' : 'attachment'),
      mimeType: file.type || 'application/octet-stream', size: file.size, createdAt: timestamp};
    if (kind === 'image') Object.assign(asset, {alt: '', caption: ''});
    await idbRequest(tx.objectStore('blobs').add({blobId, draftId, name: asset.originalName, mimeType: asset.mimeType, size: asset.size, blob: file, createdAt: timestamp}));
    const key = kind === 'image' ? 'images' : 'attachments';
    const saved = {...draft, [key]: [...(draft[key] || []), asset], draftRevision: draft.draftRevision + 1,
      dirty: true, updatedAt: timestamp, lastLocalSavedAt: timestamp};
    await idbRequest(drafts.put(saved));
    const outbox = tx.objectStore('outbox');
    const job = await idbRequest(outbox.index('byDraftOperation').get([draftId, 'upsert']));
    if (job) await idbRequest(outbox.put(updateQueuedJob(job, saved, timestamp)));
    return {draft: saved, asset};
  });
}

export async function removeResource(draftId, identifier, kind, expectedRevision) {
  if (!['image', 'file'].includes(kind)) throw new TypeError('資源類型無效');
  return withTransaction(['drafts', 'blobs', 'outbox'], 'readwrite', async tx => {
    const drafts = tx.objectStore('drafts');
    const draft = await idbRequest(drafts.get(draftId));
    if (!draft) throw new Error('草稿不存在');
    if (expectedRevision !== undefined && draft.draftRevision !== expectedRevision) throw new Error('此草稿已在另一分頁變更；請重新開啟以免覆蓋');
    const key = kind === 'image' ? 'images' : 'attachments';
    const list = draft[key] || [];
    const item = list.find(asset => asset.assetId === identifier || asset.blobId === identifier);
    if (!item) throw new Error('找不到此資源');
    const blob = await idbRequest(tx.objectStore('blobs').get(item.blobId));
    if (blob && blob.draftId !== draftId) throw new Error('資源不屬於此草稿');
    const timestamp = new Date().toISOString();
    const saved = {...draft, [key]: list.filter(asset => asset !== item), draftRevision: draft.draftRevision + 1,
      dirty: true, updatedAt: timestamp, lastLocalSavedAt: timestamp};
    await idbRequest(drafts.put(saved));
    if (blob) await idbRequest(tx.objectStore('blobs').delete(item.blobId));
    const outbox = tx.objectStore('outbox');
    const job = await idbRequest(outbox.index('byDraftOperation').get([draftId, 'upsert']));
    if (job) await idbRequest(outbox.put(updateQueuedJob(job, saved, timestamp)));
    return {draft: saved, removed: item};
  });
}

export async function getBlob(blobId) {
  return withTransaction(['blobs'], 'readonly', tx => idbRequest(tx.objectStore('blobs').get(blobId)));
}

export async function listBlobs(draftId) {
  return withTransaction(['blobs'], 'readonly', tx => idbRequest(tx.objectStore('blobs').index('byDraftId').getAll(draftId)));
}
