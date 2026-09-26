const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const base = process.env.PHASE3_BASE || 'http://127.0.0.1:4187';
const url = `${base}/knowledge-workbench/dev/phase3-draft-harness.html`;

async function readDb(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('lizhi-knowledge-workbench', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const names = [...db.objectStoreNames];
    const tx = db.transaction(names, 'readonly');
    const getAll = name => new Promise((resolve, reject) => {
      const request = tx.objectStore(name).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const [drafts, blobs, outbox, meta] = await Promise.all(['drafts', 'blobs', 'outbox', 'meta'].map(getAll));
    const keyPaths = Object.fromEntries(names.map(name => [name, tx.objectStore(name).keyPath]));
    db.close();
    return {names, keyPaths, drafts, blobs: blobs.map(({blob, ...rest}) => ({...rest, blobSize: blob.size})), outbox, meta};
  });
}

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'lizhi-phase3-check-'));
  const networkWrites = [];
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {headless: true, channel: 'chrome', serviceWorkers: 'block'});
    let page = await context.newPage();
    page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) networkWrites.push(`${request.method()} ${request.url()}`); });
    await page.goto(url);
    await page.getByRole('button', {name: '＋ 建立新草稿'}).click();
    await page.waitForURL(/\?draft=/);
    const draftId = new URL(page.url()).searchParams.get('draft');
    assert.match(draftId, /^[0-9a-f-]{36}$/i);
    await page.locator('#title').fill('Phase 3 測試草稿');
    await page.locator('#folder-path').fill('工程/測試');
    await page.locator('#body').fill('第一版內容');
    await page.locator('#tags').fill('RC, 離線');
    await page.waitForFunction(() => document.querySelector('#save-status').textContent.startsWith('本機草稿已儲存'));
    let data = await readDb(page);
    assert.deepEqual(data.names, ['blobs', 'drafts', 'meta', 'outbox']);
    assert.deepEqual(data.keyPaths, {blobs: 'blobId', drafts: 'draftId', meta: 'key', outbox: 'jobId'});
    assert.equal(data.drafts.length, 1);
    assert(data.drafts[0].draftRevision > 1);
    assert.equal(data.drafts[0].dirty, true);
    assert.equal(data.drafts[0].fields.body, '第一版內容');
    const firstRevision = data.drafts[0].draftRevision;

    await page.reload();
    assert.equal(await page.locator('#title').inputValue(), 'Phase 3 測試草稿');
    assert.equal(await page.locator('#folder-path').inputValue(), '工程/測試');
    assert.equal(await page.locator('#tags').inputValue(), 'RC, 離線');
    await context.setOffline(true);
    await page.locator('#body').fill('離線期間的新內容');
    await page.waitForFunction(() => document.querySelector('#save-status').textContent.startsWith('本機草稿已儲存'));
    assert.match(await page.locator('#connection').innerText(), /離線中/);
    data = await readDb(page);
    assert.equal(data.drafts[0].fields.body, '離線期間的新內容');
    assert(data.drafts[0].draftRevision > firstRevision);
    await context.setOffline(false);
    assert.equal((await readDb(page)).drafts[0].fields.body, '離線期間的新內容');

    await page.locator('#attachment').setInputFiles({name: 'phase3.txt', mimeType: 'text/plain', buffer: Buffer.from('local blob')});
    await page.waitForFunction(() => document.querySelector('#attachment-list').textContent.includes('phase3.txt'));
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#attachment-list').textContent.includes('phase3.txt'));
    data = await readDb(page);
    assert.equal(data.blobs.length, 1);
    assert.equal(data.blobs[0].blobSize, 10);
    assert.equal(data.drafts[0].attachments[0].blobId, data.blobs[0].blobId);
    assert(!Object.hasOwn(data.drafts[0].attachments[0], 'blob'));
    assert.equal(await page.evaluate(async blobId => {
      const {getBlob} = await import('../core/blob-store.js');
      return (await getBlob(blobId)).blob.text();
    }, data.blobs[0].blobId), 'local blob');

    await page.locator('#prepare-send').click();
    await page.waitForFunction(() => document.querySelector('#outbox-count').textContent.includes('1 筆'));
    await page.locator('#prepare-send').click();
    await page.waitForTimeout(200);
    data = await readDb(page);
    assert.equal(data.outbox.length, 1);
    assert.equal(data.outbox[0].status, 'queued');
    assert.equal(data.outbox[0].payloadRevision, data.drafts[0].draftRevision);
    await page.locator('#body').fill('排隊後再次修改');
    await page.waitForFunction(() => document.querySelector('#save-status').textContent.startsWith('本機草稿已儲存'));
    data = await readDb(page);
    assert.equal(data.outbox.length, 1);
    assert.equal(data.outbox[0].payloadRevision, data.drafts[0].draftRevision);

    await context.close();
    context = await chromium.launchPersistentContext(profile, {headless: true, channel: 'chrome', serviceWorkers: 'block'});
    page = await context.newPage();
    page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) networkWrites.push(`${request.method()} ${request.url()}`); });
    await page.goto(url);
    await page.locator('#draft-list .list-item').first().click();
    await page.waitForFunction(() => document.querySelector('#body').value === '排隊後再次修改');
    assert.equal((await readDb(page)).drafts[0].draftId, draftId);
    const databases = await page.evaluate(() => indexedDB.databases());
    assert(databases.some(database => database.name === 'lizhi-knowledge-workbench'));
    assert(!databases.some(database => ['lizhi-local-cloud', 'lizhi-finance'].includes(database.name)));

    page.once('dialog', dialog => dialog.accept());
    await page.locator('#delete-draft').click();
    await page.waitForFunction(() => document.querySelector('#draft-list').textContent.includes('目前沒有本機草稿'));
    data = await readDb(page);
    assert.equal(data.drafts.length, 0);
    assert.equal(data.blobs.length, 0);
    assert.equal(data.outbox.length, 0);
    assert.deepEqual(networkWrites, []);
    console.log('PASS: autosave, refresh, browser restart, offline edit, blob persistence, outbox dedup/update, delete cleanup, no network writes, isolated DB');
  } finally {
    if (context) await context.close();
    const resolved = path.resolve(profile);
    const tempRoot = path.resolve(os.tmpdir()) + path.sep;
    if (resolved.startsWith(tempRoot)) await fs.rm(resolved, {recursive: true, force: true});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
