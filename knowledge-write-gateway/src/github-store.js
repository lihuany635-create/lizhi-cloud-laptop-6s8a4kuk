import {createHash} from 'node:crypto';

const digest = value => createHash('sha256').update(value).digest('hex');
const fail = (message, status = 500, details) => { throw Object.assign(new Error(message), {status, details}); };

export class GitHubStore {
  constructor(env, fetchImpl = fetch) {
    for (const name of ['GITHUB_OWNER', 'GITHUB_REPO', 'GITHUB_BRANCH', 'GITHUB_TOKEN']) if (!env[name]) throw new Error(`${name} 必填`);
    if (env.GITHUB_BRANCH !== 'knowledge-data') throw new Error('Gateway 只允許寫入 knowledge-data 分支');
    this.env = env;
    this.fetch = fetchImpl;
    this.api = `https://api.github.com/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}`;
  }

  async request(method, path, body, accepted = [200, 201]) {
    const response = await this.fetch(`${this.api}${path}`, {method, headers: {
      accept: 'application/vnd.github+json', authorization: `Bearer ${this.env.GITHUB_TOKEN}`,
      'content-type': 'application/json', 'user-agent': 'lizhi-knowledge-write-gateway',
    }, body: body === undefined ? undefined : JSON.stringify(body)});
    if (!accepted.includes(response.status)) {
      if (response.status === 422 || response.status === 409) fail('資料版本已變更，請重新讀取後再試', 409);
      if (response.status === 404) fail('資料庫項目不存在', 404);
      fail('GitHub 資料存取失敗', response.status >= 500 ? 503 : 502);
    }
    return response.json();
  }

  async head() {
    const ref = await this.request('GET', `/git/ref/heads/${encodeURIComponent(this.env.GITHUB_BRANCH)}`);
    const commit = await this.request('GET', `/git/commits/${ref.object.sha}`);
    return {commitSha: ref.object.sha, treeSha: commit.tree.sha};
  }

  async readJson(path, ref, optional = false) {
    const url = `/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`;
    try {
      const file = await this.request('GET', url);
      return JSON.parse(Buffer.from(file.content.replace(/\s/g, ''), 'base64').toString('utf8'));
    } catch (error) {
      if (optional && error.status === 404) return null;
      throw error;
    }
  }

  async snapshot() {
    const head = await this.head();
    const [manifest, records, trash] = await Promise.all([
      this.readJson('manifest.json', head.commitSha), this.readJson('indexes/records.json', head.commitSha), this.readJson('indexes/trash.json', head.commitSha),
    ]);
    return {manifest, records, trash};
  }

  async getRecord(id) {
    const head = await this.head();
    return this.readJson(`records/${id}.json`, head.commitSha, true);
  }

  async commit(head, files, message, extraTree = []) {
    const tree = await this.request('POST', '/git/trees', {base_tree: head.treeSha, tree: [...files.map(([path, content]) => ({path, mode: '100644', type: 'blob', content: JSON.stringify(content, null, 2) + '\n'})), ...extraTree]});
    const commit = await this.request('POST', '/git/commits', {message, tree: tree.sha, parents: [head.commitSha]});
    await this.request('PATCH', `/git/refs/heads/${encodeURIComponent(this.env.GITHUB_BRANCH)}`, {sha: commit.sha, force: false});
    return commit.sha;
  }

  async mutate({key, payload, operation}) {
    const ledgerPath = `state/idempotency/${digest(key)}.json`;
    const payloadHash = digest(JSON.stringify(payload));
    for (let attempt = 0; attempt < 5; attempt++) {
      const head = await this.head();
      const existing = await this.readJson(ledgerPath, head.commitSha, true);
      if (existing) {
        if (existing.payloadHash !== payloadHash) fail('Idempotency-Key 已用於其他內容', 409);
        return existing.result;
      }
      const change = await operation(head);
      const files = [...change.files, [ledgerPath, {payloadHash, result: change.result, committedAt: new Date().toISOString()}]];
      try { await this.commit(head, files, change.message, change.extraTree); return change.result; }
      catch (error) { if (error.status !== 409 || attempt === 4) throw error; }
    }
    fail('資料庫忙碌，請稍後重試', 409);
  }

  async upsert({id, expectedRevision, record, idempotencyKey}) {
    return this.mutate({key: idempotencyKey, payload: {id, expectedRevision, record}, operation: async head => {
      const path = `records/${id}.json`;
      const existing = await this.readJson(path, head.commitSha, true);
      const actual = existing?.revision || 0;
      if (actual !== expectedRevision || existing?.status === 'trashed') fail('Record 版本衝突', 409, {currentRevision: actual});
      for (const asset of [...record.images, ...record.attachments]) {
        const metadata = await this.readJson(`assets/${id}/${asset.assetId}.json`, head.commitSha, true);
        if (!metadata || metadata.sha256 !== asset.sha256 || metadata.mimeType !== asset.mimeType || metadata.size !== asset.size || metadata.remotePath !== asset.remotePath || metadata.url !== asset.url) fail('Record 引用的資產尚未上傳或資訊不符', 422);
      }
      const [manifest, index] = await Promise.all([this.readJson('manifest.json', head.commitSha), this.readJson('indexes/records.json', head.commitSha)]);
      const now = new Date().toISOString();
      const next = {...record, revision: actual + 1, status: 'active', createdAt: existing?.createdAt || now, updatedAt: now, deletedAt: null};
      const summary = {id, title: next.title, folderPath: next.folderPath, templateId: next.templateId, tags: next.tags, revision: next.revision, updatedAt: now};
      const items = [...index.items.filter(item => item.id !== id), summary].sort((a, b) => a.id.localeCompare(b.id));
      const result = {status: 'synced', record: next, dataRevision: manifest.dataRevision + 1};
      return {files: [[path, next], ['indexes/records.json', {...index, revision: index.revision + 1, updatedAt: now, items}], ['manifest.json', {...manifest, dataRevision: manifest.dataRevision + 1, updatedAt: now}]], message: `knowledge: upsert ${id} r${next.revision}`, result};
    }});
  }

  async softDelete({id, expectedRevision, idempotencyKey}) {
    return this.mutate({key: idempotencyKey, payload: {id, expectedRevision, operation: 'delete'}, operation: async head => {
      const path = `records/${id}.json`;
      const existing = await this.readJson(path, head.commitSha, true);
      if (!existing) fail('Record 不存在', 404);
      if (existing.revision !== expectedRevision || existing.status === 'trashed') fail('Record 版本衝突', 409, {currentRevision: existing.revision});
      const [manifest, active, trash] = await Promise.all([this.readJson('manifest.json', head.commitSha), this.readJson('indexes/records.json', head.commitSha), this.readJson('indexes/trash.json', head.commitSha)]);
      const now = new Date().toISOString();
      const next = {...existing, revision: existing.revision + 1, status: 'trashed', deletedAt: now, updatedAt: now};
      const summary = {id, title: next.title, folderPath: next.folderPath, revision: next.revision, updatedAt: now, deletedAt: now};
      const result = {status: 'trashed', record: next, dataRevision: manifest.dataRevision + 1};
      return {files: [[path, next], ['indexes/records.json', {...active, revision: active.revision + 1, updatedAt: now, items: active.items.filter(item => item.id !== id)}], ['indexes/trash.json', {...trash, revision: trash.revision + 1, updatedAt: now, items: [...trash.items.filter(item => item.id !== id), summary]}], ['manifest.json', {...manifest, dataRevision: manifest.dataRevision + 1, updatedAt: now}]], message: `knowledge: trash ${id} r${next.revision}`, result};
    }});
  }

  async uploadAsset({assetId, recordId, mimeType, size, sha256, bytes, idempotencyKey}) {
    const path = `assets/${recordId}/${assetId}`;
    return this.mutate({key: idempotencyKey, payload: {assetId, recordId, mimeType, size, sha256}, operation: async head => {
      const existing = await this.readJson(`${path}.json`, head.commitSha, true);
      if (existing) {
        if (existing.sha256 !== sha256) fail('相同 assetId 的內容不同', 409);
        return {files: [], message: `knowledge: asset ${assetId}`, result: existing};
      }
      const blob = await this.request('POST', '/git/blobs', {content: Buffer.from(bytes).toString('base64'), encoding: 'base64'});
      const manifest = await this.readJson('manifest.json', head.commitSha);
      const now = new Date().toISOString();
      const metadata = {assetId, recordId, mimeType, size, sha256, remotePath: path, url: `https://raw.githubusercontent.com/${this.env.GITHUB_OWNER}/${this.env.GITHUB_REPO}/${this.env.GITHUB_BRANCH}/${path}`, uploadedAt: now};
      return {files: [[`${path}.json`, metadata], ['manifest.json', {...manifest, dataRevision: manifest.dataRevision + 1, updatedAt: now}]], extraTree: [{path, mode: '100644', type: 'blob', sha: blob.sha}], message: `knowledge: asset ${assetId}`, result: metadata};
    }});
  }
}
