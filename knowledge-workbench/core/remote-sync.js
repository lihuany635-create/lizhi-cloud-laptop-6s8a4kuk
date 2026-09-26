import {getBlob} from './blob-store.js';
import {claimOutbox, failOutbox, finishOutbox, listOutbox, recoverExpiredOutbox} from './outbox-store.js';

const CONFIG_KEY = 'lizhi-knowledge-gateway-url';
let session = null;
let sessionOrigin = null;

export function gatewayUrl() { return localStorage.getItem(CONFIG_KEY) || ''; }
export function setGatewayUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Gateway 網址必須是 HTTPS 網站根網址');
  localStorage.setItem(CONFIG_KEY, url.origin);
  session = null;
  sessionOrigin = null;
  return url.origin;
}

function endpoint(path) {
  const base = gatewayUrl();
  if (!base) throw new Error('請先設定正式送出 Gateway 網址');
  return `${base}${path}`;
}

async function parse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.currentRevision = body.currentRevision;
    throw error;
  }
  return body;
}

export async function authenticate(writeSecret) {
  if (!writeSecret) throw new Error('請輸入寫入密鑰');
  const base = gatewayUrl();
  const response = await fetch(endpoint('/api/auth/session'), {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({writeSecret}), cache: 'no-store'});
  const result = await parse(response);
  session = result;
  sessionOrigin = base;
  return result.expiresAt;
}

export function hasSession() { return Boolean(session && sessionOrigin === gatewayUrl() && Date.parse(session.expiresAt) > Date.now()); }

async function write(path, {method = 'PUT', body, idempotencyKey, headers = {}}) {
  if (!hasSession()) throw new Error('編輯 session 已過期，請重新驗證寫入密鑰');
  return parse(await fetch(endpoint(path), {method, headers: {authorization: `Bearer ${session.accessToken}`, 'idempotency-key': idempotencyKey, ...headers}, body, cache: 'no-store'}));
}

async function uploadAsset(job, asset, recordId) {
  if (asset.remotePath && asset.url && asset.sha256) return asset;
  const blobEntry = await getBlob(asset.blobId);
  if (!blobEntry?.blob || blobEntry.draftId !== job.draftId) throw new Error(`找不到附件 ${asset.originalName || asset.assetId} 的本機資料`);
  if (blobEntry.blob.size > 4 * 1024 * 1024) throw Object.assign(new Error(`附件 ${asset.originalName || asset.assetId} 超過 Vercel 的 4 MiB 安全上限`), {status: 422});
  const bytes = await blobEntry.blob.arrayBuffer();
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const result = await write('/api/assets', {method: 'POST', body: bytes, idempotencyKey: `${job.jobId}:${job.payloadRevision}:${asset.assetId}`,
    headers: {'content-type': 'application/octet-stream', 'x-asset-id': asset.assetId, 'x-record-id': recordId, 'x-asset-mime': asset.mimeType, 'x-asset-sha256': hash}});
  return {...asset, ...result, blobId: asset.blobId};
}

export async function sendJob(jobId) {
  const job = await claimOutbox(jobId);
  if (!job) return null;
  try {
    const id = job.recordId || job.draftId;
    const payload = structuredClone(job.payload);
    const images = [];
    const attachments = [];
    for (const asset of payload.images || []) images.push(await uploadAsset(job, asset, id));
    for (const asset of payload.attachments || []) attachments.push(await uploadAsset(job, asset, id));
    const record = {schemaVersion: 1, id, title: payload.title, folderPath: payload.folderPath, templateId: payload.templateId,
      templateVersion: payload.templateVersion, fields: payload.fields, tags: payload.tags, images, attachments, links: payload.links, relations: payload.relations};
    const expectedRevision = job.remoteRevision || 0;
    const result = await write(`/api/records/${id}`, {body: JSON.stringify({record, expectedRevision}), idempotencyKey: `${job.jobId}:${job.payloadRevision}:record`, headers: {'content-type': 'application/json'}});
    await finishOutbox(jobId, job.claimId, job.payloadRevision, result);
    return result;
  } catch (error) {
    const status = error.status === 409 ? 'conflict' : error.status >= 400 && error.status < 500 ? 'needs-review' : 'retry';
    await failOutbox(jobId, job.claimId, status, error.message);
    throw error;
  }
}

export async function sendPending() {
  await recoverExpiredOutbox();
  const jobs = await listOutbox();
  const outcomes = [];
  for (const job of jobs.filter(item => ['queued', 'retry'].includes(item.status))) {
    try { outcomes.push({jobId: job.jobId, result: await sendJob(job.jobId)}); }
    catch (error) { outcomes.push({jobId: job.jobId, error}); }
  }
  return outcomes;
}

export async function readRemoteSnapshot() { return parse(await fetch(endpoint('/api/sync/snapshot'), {cache: 'no-store'})); }
export async function readRemoteRecord(id) { return parse(await fetch(endpoint(`/api/records/${encodeURIComponent(id)}`), {cache: 'no-store'})); }
