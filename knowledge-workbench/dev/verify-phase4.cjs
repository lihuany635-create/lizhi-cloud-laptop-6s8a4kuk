const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const base = process.env.PHASE4_BASE || 'http://127.0.0.1:4187';
const profileRoot = os.tmpdir();

async function dbSnapshot(page) {
  return page.evaluate(async () => {
    const {openDraftDb, DB_NAME, DB_VERSION} = await import('./knowledge-workbench/core/draft-db.js');
    const db = await openDraftDb();
    const names = [...db.objectStoreNames];
    const tx = db.transaction(names, 'readonly');
    const all = name => new Promise((resolve, reject) => {
      const request = tx.objectStore(name).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const [drafts, blobs, outbox] = await Promise.all(['drafts', 'blobs', 'outbox'].map(all));
    return {DB_NAME, DB_VERSION, names, drafts, blobs: blobs.map(({blob, ...item}) => ({...item, blobSize: blob.size})), outbox};
  });
}

(async () => {
  const profile = await fs.mkdtemp(path.join(profileRoot, 'lizhi-phase4-check-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {headless: true, channel: 'chrome', serviceWorkers: 'block', viewport: {width: 1365, height: 850}});
    let page = await context.newPage();
    const errors = [], writes = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(`${request.method()} ${request.url()}`); });
    await page.goto(`${base}/`);
    await page.locator('.shell.route-home').waitFor();
    const navKeys = await page.locator('.nav-link').evaluateAll(items => items.map(item => item.dataset.route));
    for (const route of ['home', 'knowledge', 'knowledge-workbench', 'media', 'chat', 'study', 'a4', 'uploads', 'trash', 'settings']) assert(navKeys.includes(route), `missing ${route}`);
    await page.locator('.nav-link[data-route="knowledge-workbench"]').click();
    await page.locator('.route-knowledge-workbench .kw-editor').waitFor();
    assert.equal(new URL(page.url()).searchParams.get('open'), 'knowledge-workbench');
    assert.equal(await page.getByRole('heading', {name: '知識工作台'}).count(), 1);
    assert.equal(await page.locator('.route-knowledge-workbench .kw-fields').count(), 1);
    await page.locator('[data-kw="manifest"]').click();
    await page.waitForFunction(() => document.querySelector('[data-kw="manifest-status"]').textContent.includes('可唯讀存取'));
    await page.locator('[data-kw="new"]').click();
    await page.locator('[data-kw="folder-dialog"]').waitFor({state: 'visible'});
    await page.locator('[data-kw="folder-name"]').fill('工程/測試');
    await page.locator('[data-kw="folder-create"]').click();
    await page.waitForFunction(() => document.querySelector('[data-kw="picker-crumb"]').textContent.includes('測試'));
    await page.locator('[data-kw="folder-confirm"]').click();
    await page.locator('[data-kw="template-dialog"]').waitFor({state: 'visible'});
    await page.locator('[data-kw="template-confirm"]').click();
    await page.waitForURL(/draft=/);
    const draftId = new URL(page.url()).searchParams.get('draft');
    await page.locator('[data-kw="title"]').fill('Phase 4 正式草稿');
    await page.locator('[data-kw="body"]').fill('工作台正式頁測試內容');
    await page.locator('[data-kw="tags"]').fill('RC, 工作台');
    await page.waitForFunction(() => document.querySelector('[data-kw="save-status"]').textContent === '本機草稿已儲存');
    let data = await dbSnapshot(page);
    assert.equal(data.DB_NAME, 'lizhi-knowledge-workbench');
    assert.equal(data.DB_VERSION, 1);
    assert.deepEqual(data.names, ['blobs', 'drafts', 'meta', 'outbox']);
    assert.equal(data.drafts.length, 1);
    assert.equal(data.drafts[0].draftId, draftId);
    assert(data.drafts[0].draftRevision > 1);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('[data-kw="body"]')?.value === '工作台正式頁測試內容');
    assert.equal(await page.locator('[data-kw="tags"]').inputValue(), 'RC, 工作台');

    await context.setOffline(true);
    await page.locator('[data-kw="manifest"]').click();
    await page.waitForFunction(() => document.querySelector('[data-kw="manifest-status"]').textContent.includes('本機草稿仍可使用'));
    await page.locator('[data-kw="body"]').fill('離線修改後仍留在本機');
    await page.waitForFunction(() => document.querySelector('[data-kw="save-status"]').textContent === '本機草稿已儲存');
    assert.equal((await dbSnapshot(page)).drafts[0].fields.body, '離線修改後仍留在本機');
    await context.setOffline(false);
    await page.locator('[data-kw="attachment"]').setInputFiles({name: 'phase4.txt', mimeType: 'text/plain', buffer: Buffer.from('attachment')});
    await page.waitForFunction(() => document.querySelector('[data-kw="attachments"]').textContent.includes('phase4.txt'));
    await page.locator('[data-kw="prepare"]').click();
    await page.waitForFunction(() => document.querySelector('[data-kw="outbox-count"]').textContent === '1 筆');
    await page.locator('[data-kw="prepare"]').click();
    data = await dbSnapshot(page);
    assert.equal(data.blobs.length, 1);
    assert.equal(data.outbox.length, 1);
    assert.equal(data.outbox[0].payloadRevision, data.drafts[0].draftRevision);
    assert.equal(data.outbox[0].status, 'queued');
    await page.locator('[data-kw="body"]').fill('再次修改 queued 草稿');
    await page.waitForFunction(() => document.querySelector('[data-kw="save-status"]').textContent === '本機草稿已儲存');
    data = await dbSnapshot(page);
    assert.equal(data.outbox[0].payloadRevision, data.drafts[0].draftRevision);

    const concurrent = await page.evaluate(async () => {
      const store = await import('./knowledge-workbench/core/draft-store.js');
      const created = await store.createDraft();
      const stale = await store.getDraft(created.draftId);
      await store.saveDraft({...created, title: 'newer'});
      try { await store.saveDraft({...stale, title: 'older'}); return {rejected: false}; }
      catch { const current = await store.getDraft(created.draftId); await store.deleteDraft(created.draftId); return {rejected: true, currentTitle: current.title}; }
    });
    assert.deepEqual(concurrent, {rejected: true, currentTitle: 'newer'});

    await context.close();
    context = await chromium.launchPersistentContext(profile, {headless: true, channel: 'chrome', serviceWorkers: 'block', viewport: {width: 1365, height: 850}});
    page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(`${request.method()} ${request.url()}`); });
    await page.goto(`${base}/?open=knowledge-workbench`);
    await page.locator('.kw-draft-card').first().click();
    await page.waitForFunction(() => document.querySelector('[data-kw="body"]')?.value === '再次修改 queued 草稿');

    await page.getByRole('button', {name: '選擇收藏庫'}).click();
    await page.locator('.nav-link[data-route="knowledge"]').click();
    await page.locator('.shell.route-knowledge').waitFor();
    assert.equal(new URL(page.url()).searchParams.get('draft'), null);
    assert(await page.getByRole('heading', {name: '知識工作區'}).count() > 0);
    for (const route of ['media', 'study', 'a4', 'uploads', 'trash', 'settings']) {
      await page.goto(`${base}/?open=${route}`);
      await page.locator(`.shell.route-${route}`).waitFor();
    }
    await page.setViewportSize({width: 390, height: 844});
    await page.getByRole('button', {name: '選擇收藏庫'}).click();
    assert(await page.locator('.nav-link[data-route="knowledge-workbench"]').isVisible());
    await page.locator('.nav-link[data-route="knowledge-workbench"]').click();
    await page.locator('.route-knowledge-workbench .kw-editor').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2), false);
    await page.locator('.kw-draft-card').first().click();
    await page.waitForFunction(() => document.querySelector('[data-kw="body"]')?.value === '再次修改 queued 草稿');
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, []);
    console.log('PASS: formal route, old route, draft reuse/recovery, offline, blob, queued outbox, revision guard, existing navigation, mobile width, no network writes or page errors');
  } finally {
    if (context) await context.close();
    const resolved = path.resolve(profile);
    if (resolved.startsWith(path.resolve(profileRoot) + path.sep)) await fs.rm(resolved, {recursive: true, force: true});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
