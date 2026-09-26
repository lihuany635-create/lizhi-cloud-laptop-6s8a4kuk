import test from 'node:test';
import assert from 'node:assert/strict';
import {createGateway} from '../src/gateway.js';
import {GitHubStore} from '../src/github-store.js';

const id = 'a85fc852-04a9-49a6-9a4b-7ad310065b80';
const secret = 'test-secret-with-at-least-24-characters';
const origin = 'https://example.github.io';
const env = {ALLOWED_ORIGIN: origin, KNOWLEDGE_WRITE_SECRET: secret, GITHUB_OWNER: 'owner', GITHUB_REPO: 'repo', GITHUB_BRANCH: 'knowledge-data', GITHUB_TOKEN: 'server-only-token'};

class MemoryStore extends GitHubStore {
  constructor() {
    super(env, async () => { throw new Error('unexpected network'); });
    this.revision = 1;
    this.files = new Map([
      ['manifest.json', {schemaVersion: 1, dataModel: 'lizhi-knowledge', branch: 'knowledge-data', dataRevision: 1, indexes: {records: 'indexes/records.json', trash: 'indexes/trash.json'}}],
      ['indexes/records.json', {schemaVersion: 1, revision: 1, items: []}],
      ['indexes/trash.json', {schemaVersion: 1, revision: 1, items: []}],
    ]);
  }
  async head() { return {commitSha: String(this.revision), treeSha: String(this.revision)}; }
  async readJson(path, _ref, optional) {
    if (!this.files.has(path)) {
      if (optional) return null;
      throw Object.assign(new Error('missing'), {status: 404});
    }
    return structuredClone(this.files.get(path));
  }
  async commit(head, files, _message, extraTree = []) {
    if (Number(head.commitSha) !== this.revision) throw Object.assign(new Error('race'), {status: 409});
    for (const [path, content] of files) this.files.set(path, structuredClone(content));
    for (const entry of extraTree) this.files.set(entry.path, {blobSha: entry.sha});
    this.revision++;
  }
  async request(method, path, body) {
    if (method === 'POST' && path === '/git/blobs') return {sha: `blob-${body.content.length}`};
    throw new Error(`unexpected ${method} ${path}`);
  }
}

const record = {schemaVersion: 1, id, title: '第一筆知識', folderPath: '工程/RC', templateId: 'general-note', templateVersion: 1,
  fields: {body: '內容'}, tags: ['RC'], images: [], attachments: [], links: [], relations: []};

test('upsert, idempotency, conflict, delete keep record/index/manifest together', async () => {
  const store = new MemoryStore();
  const first = await store.upsert({id, expectedRevision: 0, record, idempotencyKey: 'create-key-123456'});
  assert.equal(first.record.revision, 1);
  assert.equal(store.files.get('manifest.json').dataRevision, 2);
  assert.equal(store.files.get('indexes/records.json').items.length, 1);
  assert.deepEqual(await store.upsert({id, expectedRevision: 0, record, idempotencyKey: 'create-key-123456'}), first);
  assert.equal(store.files.get('manifest.json').dataRevision, 2);
  await assert.rejects(store.upsert({id, expectedRevision: 0, record: {...record, title: '不同內容'}, idempotencyKey: 'create-key-123456'}), {status: 409});
  await assert.rejects(store.upsert({id, expectedRevision: 0, record, idempotencyKey: 'new-key-123456789'}), {status: 409});
  const second = await store.upsert({id, expectedRevision: 1, record: {...record, title: '更新'}, idempotencyKey: 'update-key-123456'});
  assert.equal(second.record.revision, 2);
  const deleted = await store.softDelete({id, expectedRevision: 2, idempotencyKey: 'delete-key-123456'});
  assert.equal(deleted.record.status, 'trashed');
  assert.equal(store.files.get('indexes/records.json').items.length, 0);
  assert.equal(store.files.get('indexes/trash.json').items.length, 1);
  assert.equal(store.files.get('manifest.json').dataRevision, 4);
});

test('asset must exist before record may reference it', async () => {
  const store = new MemoryStore();
  const bytes = new TextEncoder().encode('hello');
  const sha256 = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
  const assetId = 'd4808858-5244-4f09-ace0-025d080647ba';
  const asset = await store.uploadAsset({assetId, recordId: id, mimeType: 'text/plain', size: bytes.length, sha256, bytes, idempotencyKey: 'asset-key-1234567'});
  assert.equal(asset.remotePath, `assets/${id}/${assetId}`);
  const enriched = {...record, attachments: [{...asset, blobId: '1505e1ce-4c24-4ad0-bc17-e76e5b405849'}]};
  const result = await store.upsert({id, expectedRevision: 0, record: enriched, idempotencyKey: 'asset-record-key-123456'});
  assert.equal(result.record.attachments.length, 1);
  await assert.rejects(store.upsert({id, expectedRevision: 1, record: {...enriched, attachments: [{...enriched.attachments[0], sha256: 'a'.repeat(64)}]}, idempotencyKey: 'bad-asset-key-123456'}), {status: 422});
});

test('gateway rejects foreign origin and invalid token, then accepts session', async () => {
  const store = new MemoryStore();
  const handle = createGateway({store, env});
  const call = (path, method, body, headers = {}) => handle(new Request(`https://gateway.example${path}`, {method, headers, body}));
  assert.equal((await call('/api/auth/session', 'POST', JSON.stringify({writeSecret: secret}), {origin: 'https://evil.example'})).status, 403);
  assert.equal((await call('/api/records/' + id, 'PUT', JSON.stringify({expectedRevision: 0, record}), {origin, 'content-type': 'application/json', 'idempotency-key': 'create-key-123456'})).status, 401);
  const auth = await (await call('/api/auth/session', 'POST', JSON.stringify({writeSecret: secret}), {origin, 'content-type': 'application/json'})).json();
  assert.ok(auth.accessToken);
  const response = await call('/api/records/' + id, 'PUT', JSON.stringify({expectedRevision: 0, record}), {origin, authorization: `Bearer ${auth.accessToken}`, 'content-type': 'application/json', 'idempotency-key': 'create-key-123456'});
  assert.equal(response.status, 200);
  assert.equal((await response.json()).record.revision, 1);
  assert.equal((await call('/api/records/' + id, 'GET')).status, 200);
});

test('five failed secrets lock the caller and oversized JSON is rejected', async () => {
  const handle = createGateway({store: new MemoryStore(), env});
  const request = value => handle(new Request('https://gateway.example/api/auth/session', {method: 'POST', headers: {origin, 'content-type': 'application/json', 'x-vercel-forwarded-for': '192.0.2.3'}, body: JSON.stringify({writeSecret: value})}));
  for (let i = 0; i < 5; i++) assert.equal((await request('wrong')).status, 401);
  assert.equal((await request(secret)).status, 429);
  const oversized = await handle(new Request('https://gateway.example/api/auth/session', {method: 'POST', headers: {origin, 'content-type': 'application/json'}, body: 'x'.repeat(5000)}));
  assert.equal(oversized.status, 413);
});
