export const DB_NAME = 'lizhi-knowledge-workbench';
export const DB_VERSION = 1;

let opening;

export function openDraftDb() {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('drafts')) {
          const drafts = db.createObjectStore('drafts', {keyPath: 'draftId'});
          drafts.createIndex('byUpdatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('blobs')) {
          const blobs = db.createObjectStore('blobs', {keyPath: 'blobId'});
          blobs.createIndex('byDraftId', 'draftId');
        }
        if (!db.objectStoreNames.contains('outbox')) {
          const outbox = db.createObjectStore('outbox', {keyPath: 'jobId'});
          outbox.createIndex('byDraftOperation', ['draftId', 'operation'], {unique: true});
        }
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', {keyPath: 'key'});
        request.transaction.objectStore('meta').put({key: 'schemaVersion', value: DB_VERSION});
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => reject(request.error || new Error('無法開啟本機草稿資料庫'));
      request.onblocked = () => reject(new Error('其他分頁仍開著舊版草稿資料庫，請關閉後重試'));
    }).catch(error => { opening = null; throw error; });
  }
  return opening;
}

export function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request 失敗'));
  });
}

export async function withTransaction(names, mode, work) {
  const db = await openDraftDb();
  const tx = db.transaction(names, mode);
  const done = new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction 失敗'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction 已取消'));
  });
  try {
    const result = await work(tx);
    await done;
    return result;
  } catch (error) {
    try { tx.abort(); } catch { /* Already completed or aborted. */ }
    await done.catch(() => {});
    throw error;
  }
}
