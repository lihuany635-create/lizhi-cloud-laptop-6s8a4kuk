export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const SHA256 = /^[0-9a-f]{64}$/i;
export const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'application/pdf', 'text/plain',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
// Keep below Vercel Functions' 4.5 MB request-body limit.
export const MAX_ASSET_BYTES = 4 * 1024 * 1024;

export function isHttpUrl(value) {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); }
  catch { return false; }
}

export function validateRecord(record, id) {
  const errors = [];
  if (!record || typeof record !== 'object' || Array.isArray(record)) return ['record 必須是物件'];
  if (!UUID.test(id) || record.id !== id) errors.push('record id 必須與路徑的 UUID 一致');
  if (record.schemaVersion !== 1) errors.push('schemaVersion 必須是 1');
  if (typeof record.title !== 'string' || !record.title.trim() || record.title.length > 200) errors.push('title 不可空白或超過 200 字');
  if (typeof record.folderPath !== 'string' || record.folderPath.length > 500 || record.folderPath.startsWith('/') || record.folderPath.endsWith('/') || record.folderPath.includes('\\') || record.folderPath.split('/').some(part => part === '.' || part === '..' || part === '')) errors.push('folderPath 無效');
  if (typeof record.templateId !== 'string' || !Number.isSafeInteger(record.templateVersion) || record.templateVersion < 1) errors.push('模板識別無效');
  if (!record.fields || typeof record.fields !== 'object' || Array.isArray(record.fields)) errors.push('fields 必須是物件');
  for (const key of ['tags', 'images', 'attachments', 'links', 'relations']) if (!Array.isArray(record[key])) errors.push(`${key} 必須是陣列`);
  for (const link of Array.isArray(record.links) ? record.links : []) if (!isHttpUrl(link?.url)) errors.push('links 只接受 http/https');
  const targets = new Set();
  for (const relation of Array.isArray(record.relations) ? record.relations : []) {
    if (!UUID.test(relation?.targetId) || relation.targetId === id || targets.has(relation.targetId)) errors.push('relations 含無效、自我或重複 targetId');
    targets.add(relation.targetId);
  }
  for (const asset of [...(Array.isArray(record.images) ? record.images : []), ...(Array.isArray(record.attachments) ? record.attachments : [])]) {
    if (!UUID.test(asset?.assetId) || (asset.blobId != null && !UUID.test(asset.blobId)) || !SHA256.test(asset?.sha256) || !Number.isSafeInteger(asset?.size) || asset.size < 0 || asset.size > MAX_ASSET_BYTES || !ALLOWED_MIME.has(asset?.mimeType) || asset?.remotePath !== `assets/${id}/${asset.assetId}` || !isHttpUrl(asset?.url)) errors.push('資產 metadata 無效或未上傳');
  }
  return errors;
}
