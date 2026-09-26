import {createHash} from 'node:crypto';
import {createAuth} from './auth.js';
import {ALLOWED_MIME, MAX_ASSET_BYTES, SHA256, UUID, validateRecord} from './validation.js';

const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {status, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers}});
const boundedBytes = async (request, maxBytes) => {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > maxBytes) throw Object.assign(new Error('請求過大'), {status: 413});
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) { await reader.cancel(); throw Object.assign(new Error('請求過大'), {status: 413}); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
};
const bodyJson = async (request, maxBytes = 2 * 1024 * 1024) => {
  const bytes = await boundedBytes(request, maxBytes);
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw Object.assign(new Error('JSON 無效'), {status: 400}); }
};

export function createGateway({store, env, now} = {}) {
  if (!store) throw new Error('store 必填');
  const allowedOrigin = env?.ALLOWED_ORIGIN;
  if (!allowedOrigin || !/^https:\/\//.test(allowedOrigin)) throw new Error('ALLOWED_ORIGIN 必須是 HTTPS origin');
  const auth = createAuth(env.KNOWLEDGE_WRITE_SECRET, {now});
  return async function handle(request) {
    const origin = request.headers.get('origin');
    const cors = origin === allowedOrigin ? {'access-control-allow-origin': allowedOrigin, 'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS', 'access-control-allow-headers': 'authorization, content-type, idempotency-key, x-asset-id, x-record-id, x-asset-sha256, x-asset-mime', vary: 'Origin'} : {};
    const reply = (value, status, headers) => json(value, status, {...cors, ...headers});
    const url = new URL(request.url);
    const route = url.searchParams.get('route');
    const path = route && url.pathname === '/api/index' ? `/api/${route}` : url.pathname;
    try {
      if (request.method === 'OPTIONS') return origin === allowedOrigin ? new Response(null, {status: 204, headers: cors}) : reply({error: 'Origin 不允許'}, 403);
      if (path === '/api/health' && request.method === 'GET') return reply({status: 'ok'}, 200);
      if (path === '/api/sync/snapshot' && request.method === 'GET') return reply(await store.snapshot(), 200);
      if (request.method !== 'GET' && origin !== allowedOrigin) return reply({error: 'Origin 不允許'}, 403);
      if (path === '/api/auth/session' && request.method === 'POST') {
        const body = await bodyJson(request, 4096);
        const ip = request.headers.get('x-vercel-forwarded-for') || request.headers.get('x-forwarded-for') || 'unknown';
        const result = auth.exchange(body.writeSecret, ip);
        if (result.status !== 200) return reply({error: result.status === 429 ? '請稍後再試' : '寫入密鑰不正確'}, result.status, result.retryAfter ? {'retry-after': String(result.retryAfter)} : {});
        return reply({accessToken: result.accessToken, expiresAt: result.expiresAt}, 200);
      }
      const match = path.match(/^\/api\/records\/([^/]+)$/);
      if (match && request.method === 'GET') {
        if (!UUID.test(match[1])) return reply({error: 'Record ID 無效'}, 400);
        const record = await store.getRecord(match[1]);
        return reply(record || {error: '找不到 Record'}, record ? 200 : 404);
      }
      if (!auth.verify(request.headers.get('authorization'))) return reply({error: '需要有效的編輯 session'}, 401);
      const idem = request.headers.get('idempotency-key');
      if ((request.method === 'PUT' || request.method === 'POST' || request.method === 'DELETE') && (!idem || !/^[a-zA-Z0-9:_-]{16,100}$/.test(idem))) return reply({error: 'Idempotency-Key 無效'}, 400);
      if (match && request.method === 'PUT') {
        const body = await bodyJson(request);
        const expectedRevision = body.expectedRevision;
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return reply({error: 'expectedRevision 必須是非負整數'}, 422);
        const errors = validateRecord(body.record, match[1]);
        if (errors.length) return reply({error: 'Record schema 無效', details: errors}, 422);
        return reply(await store.upsert({id: match[1], expectedRevision, record: body.record, idempotencyKey: idem}), 200);
      }
      if (path === '/api/assets' && request.method === 'POST') {
        const assetId = request.headers.get('x-asset-id');
        const recordId = request.headers.get('x-record-id');
        const mimeType = request.headers.get('x-asset-mime');
        const declaredSha = request.headers.get('x-asset-sha256');
        if (!UUID.test(assetId || '') || !UUID.test(recordId || '') || !ALLOWED_MIME.has(mimeType) || !SHA256.test(declaredSha || '')) return reply({error: '資產識別或 MIME 無效'}, 422);
        const bytes = await boundedBytes(request, MAX_ASSET_BYTES);
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        if (sha256 !== declaredSha.toLowerCase()) return reply({error: '資產 SHA-256 不符'}, 422);
        return reply(await store.uploadAsset({assetId, recordId, mimeType, size: bytes.length, sha256, bytes, idempotencyKey: idem}), 200);
      }
      if (match && request.method === 'DELETE') {
        if (!UUID.test(match[1])) return reply({error: 'Record ID 無效'}, 400);
        const body = await bodyJson(request);
        if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1) return reply({error: 'expectedRevision 無效'}, 422);
        return reply(await store.softDelete({id: match[1], expectedRevision: body.expectedRevision, idempotencyKey: idem}), 200);
      }
      return reply({error: '找不到 API'}, 404);
    } catch (error) {
      const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
      return reply(status >= 500 ? {error: 'Gateway 暫時無法處理'} : {error: error.message, ...(error.details || {})}, status);
    }
  };
}
