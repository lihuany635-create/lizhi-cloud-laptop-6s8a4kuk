const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const base = process.env.PHASE5_BASE || 'http://127.0.0.1:4187';

async function snapshot(page) {
  return page.evaluate(async () => {
    const {withTransaction, idbRequest, DB_VERSION} = await import('./knowledge-workbench/core/draft-db.js');
    return withTransaction(['drafts', 'meta', 'blobs', 'outbox'], 'readonly', async tx => ({
      version: DB_VERSION,
      drafts: await idbRequest(tx.objectStore('drafts').getAll()),
      catalog: await idbRequest(tx.objectStore('meta').get('folder-catalog-v1')),
      blobs: await idbRequest(tx.objectStore('blobs').getAll()),
      outbox: await idbRequest(tx.objectStore('outbox').getAll()),
    }));
  });
}

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'lizhi-phase5-check-'));
  const errors = [], writes = [];
  let context;
  const watch = page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(`${request.method()} ${request.url()}`); });
  };
  try {
    context = await chromium.launchPersistentContext(profile, {headless: true, channel: 'chrome', serviceWorkers: 'block', viewport: {width: 1365, height: 850}});
    let page = await context.newPage();
    watch(page);
    await page.goto(`${base}/?open=knowledge-workbench`);
    await page.locator('[data-kw="folder-browser"] .kw-folder-item').first().waitFor();

    const model = await page.evaluate(async () => {
      const m = await import('./knowledge-workbench/core/folder-model.js');
      return {
        normalized: m.normalizeFolderPath(' 工程 \\ RC // 施工問題 '),
        valid: m.validateFolderPath('工程/RC/施工問題').valid,
        invalid: ['工程/../RC', 'CON', 'aux.txt', 'RC.', '工程/測試 ', '工程/問?題', '工程/筆記.md'].map(s => m.validateFolderPath(s).valid),
        ancestors: m.getAncestorPaths('工程/RC/施工問題'),
      };
    });
    assert.equal(model.normalized, '工程/RC/施工問題');
    assert.equal(model.valid, true);
    assert(model.invalid.every(value => value === false));
    assert.deepEqual(model.ancestors, ['工程', '工程/RC', '工程/RC/施工問題']);

    await page.locator('[data-kw="new"]').click();
    await page.locator('[data-kw="folder-dialog"]').waitFor({state: 'visible'});
    assert.equal((await snapshot(page)).drafts.length, 0, 'opening picker must not create a draft');
    await page.locator('[data-kw="folder-name"]').fill('CON');
    await page.locator('[data-kw="folder-create"]').click();
    await page.waitForFunction(() => document.querySelector('[data-kw="folder-error"]').textContent.includes('保留名稱'));
    assert.match(await page.locator('[data-kw="folder-error"]').textContent(), /保留名稱/);
    assert.equal((await snapshot(page)).catalog?.folders.length || 0, 0);
    await page.locator('[data-kw="folder-name"]').fill('工程/RC/施工問題');
    await page.locator('[data-kw="folder-create"]').click();
    await page.waitForFunction(() => document.querySelector('[data-kw="picker-crumb"]').textContent.includes('施工問題'));
    let data = await snapshot(page);
    assert.deepEqual(data.catalog.folders.map(folder => folder.path), ['工程', '工程/RC', '工程/RC/施工問題']);
    const ids = data.catalog.folders.map(folder => folder.folderId);
    await page.locator('[data-kw="folder-confirm"]').click();
    await page.waitForURL(/draft=/);
    const firstId = new URL(page.url()).searchParams.get('draft');
    await page.locator('[data-kw="title"]').fill('施工問題草稿');
    await page.locator('[data-kw="body"]').fill('內容一');
    await page.waitForFunction(() => document.querySelector('[data-kw="save-status"]').textContent === '本機草稿已儲存');
    data = await snapshot(page);
    assert.equal(data.drafts[0].folderPath, '工程/RC/施工問題');
    assert.equal(data.version, 1);

    await page.locator('[data-kw="new"]').click();
    await page.locator('[data-kw="folder-name"]').fill('工程/rc/施工問題');
    await page.locator('[data-kw="folder-create"]').click();
    await page.waitForFunction(() => document.querySelector('[data-kw="folder-error"]').textContent.includes('已存在'));
    assert.match(await page.locator('[data-kw="folder-error"]').textContent(), /已存在/);
    data = await snapshot(page);
    assert.equal(data.catalog.folders.length, 3);
    assert.deepEqual(data.catalog.folders.map(folder => folder.folderId), ids);
    await page.locator('[data-kw="folder-confirm"]').click();
    await page.waitForFunction(firstId => new URL(location.href).searchParams.get('draft') !== firstId && !document.querySelector('[data-kw="folder-dialog"]').open, firstId);
    assert.equal((await snapshot(page)).drafts.find(draft => draft.draftId !== firstId).folderPath, '工程/RC/施工問題');

    await page.locator('[data-kw="choose-folder"]').click();
    await page.locator('[data-kw="picker-tree"] .kw-folder-item').first().click();
    await page.locator('[data-kw="folder-confirm"]').click();
    await page.waitForFunction(() => document.querySelector('[data-kw="folder-crumb"]').textContent.includes('根目錄'));
    data = await snapshot(page);
    assert(data.drafts.some(draft => draft.folderPath === ''));
    await page.locator('[data-kw="folder-browser"] .kw-folder-item').filter({hasText: '施工問題'}).click();
    await page.waitForFunction(() => document.querySelectorAll('.kw-draft-card').length === 1);
    assert.equal(await page.locator('.kw-draft-card').count(), 1);
    assert.match(await page.locator('[data-kw="browse-crumb"]').textContent(), /施工問題/);

    const legacy = await page.evaluate(async () => {
      const {createDraft, saveDraft} = await import('./knowledge-workbench/core/draft-store.js');
      const good = await createDraft();
      const saved = await saveDraft({...good, title: '舊版草稿', folderPath: '材料/鋼筋', fields: {body: '不得被 bootstrap 改寫'}});
      const bad = await createDraft();
      const invalid = await saveDraft({...bad, title: '舊版錯誤路徑', folderPath: 'CON'});
      return {saved, invalid};
    });
    await page.reload();
    await page.locator('[data-kw="folder-browser"] .kw-folder-item').first().waitFor();
    await page.waitForFunction(() => document.querySelector('[data-kw="folder-warnings"]').textContent.includes('1 份'));
    data = await snapshot(page);
    assert.equal(data.drafts.find(draft => draft.draftId === legacy.saved.draftId).draftRevision, legacy.saved.draftRevision);
    assert.equal(data.drafts.find(draft => draft.draftId === legacy.saved.draftId).fields.body, '不得被 bootstrap 改寫');
    assert.equal(data.drafts.find(draft => draft.draftId === legacy.invalid.draftId).folderPath, 'CON');
    assert(data.catalog.folders.some(folder => folder.path === '材料/鋼筋'));
    assert(!data.catalog.folders.some(folder => folder.path === 'CON'));
    assert.equal(data.blobs.length, 0);
    assert.equal(data.outbox.length, 0);

    await context.setOffline(true);
    await page.locator('[data-kw="new"]').click();
    await page.locator('[data-kw="folder-name"]').fill('離線/現場');
    await page.locator('[data-kw="folder-create"]').click();
    await page.locator('[data-kw="folder-confirm"]').click();
    await page.waitForURL(/draft=/);
    assert((await snapshot(page)).catalog.folders.some(folder => folder.path === '離線/現場'));
    await context.setOffline(false);
    await context.close();

    context = await chromium.launchPersistentContext(profile, {headless: true, channel: 'chrome', serviceWorkers: 'block', viewport: {width: 390, height: 844}});
    page = await context.newPage();
    watch(page);
    await page.goto(`${base}/?open=knowledge-workbench`);
    await page.locator('[data-kw="folder-browser"] .kw-folder-item').first().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2), false);
    assert((await snapshot(page)).catalog.folders.some(folder => folder.path === '離線/現場'));
    await page.locator('[data-kw="new"]').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2), false);
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, []);
    console.log('PASS: folder model, hierarchy, folder-first creation, case dedup, root selection, filtering, legacy bootstrap, offline, restart, mobile, no network writes or page errors');
  } finally {
    if (context) await context.close();
    const resolved = path.resolve(profile);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) await fs.rm(resolved, {recursive: true, force: true});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
