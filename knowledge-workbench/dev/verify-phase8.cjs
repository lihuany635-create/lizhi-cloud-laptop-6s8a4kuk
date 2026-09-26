const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const base = process.env.PHASE8_BASE || 'http://127.0.0.1:4187';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=', 'base64');

async function snapshot(page) {
  return page.evaluate(async () => {
    const {withTransaction, idbRequest, DB_VERSION} = await import('./knowledge-workbench/core/draft-db.js');
    return withTransaction(['drafts', 'blobs', 'outbox'], 'readonly', async tx => ({
      version: DB_VERSION, stores: [...tx.db.objectStoreNames],
      drafts: await idbRequest(tx.objectStore('drafts').getAll()),
      blobs: (await idbRequest(tx.objectStore('blobs').getAll())).map(({blob, ...rest}) => ({...rest, blobSize: blob.size})),
      outbox: await idbRequest(tx.objectStore('outbox').getAll()),
    }));
  });
}

async function makeDraft(page, folder, title, template = 'general-note:1') {
  const before = new URL(page.url()).searchParams.get('draft');
  await page.locator('[data-kw="new"]').click();
  await page.locator('[data-kw="folder-dialog"]').waitFor({state: 'visible'});
  await page.locator('[data-kw="folder-name"]').fill(folder);
  await page.locator('[data-kw="folder-create"]').click();
  await page.waitForFunction(name => document.querySelector('[data-kw="picker-crumb"]').textContent.includes(name), folder.split('/').at(-1));
  await page.locator('[data-kw="folder-confirm"]').click();
  await page.locator('[data-kw="template-dialog"]').waitFor({state: 'visible'});
  await page.locator('[data-kw="template-select"]').selectOption(template);
  await page.locator('[data-kw="template-confirm"]').click();
  await page.waitForFunction(previous => {
    const id = new URL(location.href).searchParams.get('draft');
    return id && id !== previous && !document.querySelector('[data-kw="template-dialog"]').open;
  }, before);
  const id = new URL(page.url()).searchParams.get('draft');
  await page.locator('[data-kw="title"]').fill(title);
  if (template === 'problem-solution:1') {
    await page.locator('[data-template-field="issue"]').fill('地下室牆面出現蜂窩');
    await page.locator('[data-template-field="solution"]').fill('先確認範圍，再依程序處理');
  }
  await page.waitForFunction(() => document.querySelector('[data-kw="save-status"]').textContent === '本機草稿已儲存');
  return id;
}

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'lizhi-phase8-check-'));
  const writes = [], errors = [];
  let context;
  const watch = page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) writes.push(`${request.method()} ${request.url()}`); });
    page.on('dialog', dialog => { if (dialog.type() === 'confirm') void dialog.accept(); });
  };
  try {
    context = await chromium.launchPersistentContext(profile, {headless: true, channel: 'chrome', serviceWorkers: 'block', viewport: {width: 1365, height: 850}});
    let page = await context.newPage();
    watch(page);
    await page.goto(`${base}/?open=knowledge-workbench`);
    await page.locator('[data-kw="folder-browser"] .kw-folder-item').first().waitFor();
    const a = await makeDraft(page, '工程/RC/施工問題', '地下室牆面蜂窩', 'problem-solution:1');
    const b = await makeDraft(page, '工程/RC/施工紀錄', '蜂窩修補紀錄');
    const c = await makeDraft(page, '工程/RC/施工紀錄', '複查紀錄');
    await page.goto(`${base}/?open=knowledge-workbench&draft=${a}`);
    await page.waitForFunction(() => document.querySelector('[data-kw="title"]')?.value === '地下室牆面蜂窩');

    const revisions = [];
    revisions.push((await snapshot(page)).drafts.find(item => item.draftId === a).draftRevision);
    await page.locator('[data-kw="image"]').setInputFiles({name: '蜂窩.jpg', mimeType: 'image/png', buffer: png});
    await page.locator('.kw-image-card img').waitFor();
    assert.match(await page.locator('.kw-image-card img').getAttribute('src'), /^blob:/);
    await page.locator('[data-image-alt]').fill('地下室牆面蜂窩');
    await page.locator('[data-image-caption]').fill('B1 外牆 A 區');
    await page.waitForFunction(() => document.querySelector('[data-kw="save-status"]').textContent === '本機草稿已儲存');
    let data = await snapshot(page);
    let draft = data.drafts.find(item => item.draftId === a);
    assert.equal(draft.images.length, 1);
    assert.equal(draft.images[0].alt, '地下室牆面蜂窩');
    assert.equal(draft.images[0].caption, 'B1 外牆 A 區');
    assert.equal(draft.images[0].originalName, '蜂窩.jpg');
    assert.equal(data.blobs.length, 1);
    revisions.push(draft.draftRevision);

    await page.evaluate(() => { window.__revokes = 0; const original = URL.revokeObjectURL; URL.revokeObjectURL = function(url) { window.__revokes += 1; return original.call(this, url); }; });
    await page.locator('[data-kw="attachment"]').setInputFiles({name: '../檢查表.txt', mimeType: 'text/plain', buffer: Buffer.from('phase8 local attachment')});
    await page.waitForFunction(() => document.querySelector('[data-kw="attachments"]').textContent.includes('檢查表.txt'));
    assert((await page.evaluate(() => window.__revokes)) > 0, 'old preview URL should be revoked on redraw');
    assert.match(await page.locator('[data-kw="attachments"] a').first().getAttribute('href'), /^blob:/);
    data = await snapshot(page);
    draft = data.drafts.find(item => item.draftId === a);
    assert.equal(draft.attachments.length, 1);
    assert.equal(draft.attachments[0].originalName, '../檢查表.txt');
    assert.equal(draft.attachments[0].mimeType, 'text/plain');
    assert.equal(data.blobs.length, 2);
    assert.equal(await page.evaluate(async blobId => {
      const {getBlob} = await import('./knowledge-workbench/core/blob-store.js');
      return (await getBlob(blobId)).blob.text();
    }, draft.attachments[0].blobId), 'phase8 local attachment');
    const staleResourceRejected = await page.evaluate(async draftId => {
      const {getDraft} = await import('./knowledge-workbench/core/draft-store.js');
      const {addResource} = await import('./knowledge-workbench/core/blob-store.js');
      const current = await getDraft(draftId);
      try { await addResource(draftId, new File(['stale'], 'stale.txt', {type: 'text/plain'}), 'file', current.draftRevision - 1); return false; }
      catch { return true; }
    }, a);
    assert(staleResourceRejected);
    assert.equal((await snapshot(page)).blobs.length, 2);
    revisions.push(draft.draftRevision);

    await page.locator('[data-kw="link-label"]').fill('參考資料');
    await page.locator('[data-kw="link-url"]').fill('https://example.com/reference');
    await page.locator('[data-kw="link-save"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-kw="links"] li').length === 1);
    const firstLinkId = (await snapshot(page)).drafts.find(item => item.draftId === a).links[0].linkId;
    await page.locator('[data-kw="link-label"]').fill('第二份');
    await page.locator('[data-kw="link-url"]').fill('https://example.com/second');
    await page.locator('[data-kw="link-save"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-kw="links"] li').length === 2);
    await page.locator('[data-edit-link]').first().click();
    await page.locator('[data-kw="link-label"]').fill('更新後參考資料');
    await page.locator('[data-kw="link-url"]').fill('https://example.com/updated');
    await page.locator('[data-kw="link-save"]').click();
    await page.waitForFunction(() => document.querySelector('[data-kw="links"]').textContent.includes('更新後參考資料'));
    data = await snapshot(page);
    draft = data.drafts.find(item => item.draftId === a);
    assert.equal(draft.links[0].linkId, firstLinkId);
    assert.equal(draft.links.length, 2);
    assert.equal(await page.locator('[data-kw="links"] a').first().getAttribute('rel'), 'noopener noreferrer');
    await page.locator('[data-remove-link]').last().click();
    await page.waitForFunction(() => document.querySelectorAll('[data-kw="links"] li').length === 1);
    revisions.push((await snapshot(page)).drafts.find(item => item.draftId === a).draftRevision);

    await page.locator('[data-kw="relation-add"]').click();
    await page.locator('[data-kw="relation-dialog"]').waitFor({state: 'visible'});
    await page.locator('[data-kw="relation-folders"] button').filter({hasText: '施工紀錄'}).click();
    await page.locator(`[data-target-id="${b}"]`).click();
    await page.waitForFunction(() => !document.querySelector('[data-kw="relation-dialog"]').open);
    data = await snapshot(page);
    draft = data.drafts.find(item => item.draftId === a);
    assert.equal(draft.relations.length, 1);
    assert.equal(draft.relations[0].targetId, b);
    assert(!Object.hasOwn(draft.relations[0], 'title'));
    const relationId = draft.relations[0].relationId;
    await page.locator('[data-kw="relation-add"]').click();
    await page.locator('[data-kw="relation-folders"] button').filter({hasText: '施工紀錄'}).click();
    await page.locator(`[data-target-id="${b}"]`).click();
    await page.waitForFunction(() => document.querySelector('[data-kw="relation-picker-error"]').textContent.includes('相同關聯'));
    await page.locator('[data-kw="relation-cancel"]').click();
    await page.locator('[data-replace-relation]').click();
    await page.locator('[data-kw="relation-folders"] button').filter({hasText: '施工紀錄'}).click();
    await page.locator(`[data-target-id="${c}"]`).click();
    await page.waitForFunction(() => !document.querySelector('[data-kw="relation-dialog"]').open);
    draft = (await snapshot(page)).drafts.find(item => item.draftId === a);
    assert.equal(draft.relations[0].targetId, c);
    assert.equal(draft.relations[0].relationId, relationId);
    const relationGuard = await page.evaluate(({source, target}) => {
      return import('./knowledge-workbench/core/resource-model.js').then(({putRelation}) => {
        try { putRelation([], source, source); return false; } catch { /* expected */ }
        try { putRelation([{relationId: 'r1', targetId: target, type: 'related'}], source, target); return false; } catch { return true; }
      });
    }, {source: a, target: c});
    assert(relationGuard);
    revisions.push(draft.draftRevision);

    await page.reload();
    await page.locator('.kw-image-card img').waitFor();
    assert.match(await page.locator('.kw-image-card img').getAttribute('src'), /^blob:/);
    assert.match(await page.locator('[data-kw="attachments"]').textContent(), /檢查表/);
    assert.match(await page.locator('[data-kw="links"]').textContent(), /更新後參考資料/);
    assert.match(await page.locator('[data-kw="relations"]').textContent(), /複查紀錄/);

    await context.close();
    context = await chromium.launchPersistentContext(profile, {headless: true, channel: 'chrome', serviceWorkers: 'block', viewport: {width: 390, height: 844}});
    page = await context.newPage(); watch(page);
    await page.goto(`${base}/?open=knowledge-workbench&draft=${a}`);
    await page.locator('.kw-image-card img').waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2), false);
    assert.equal((await snapshot(page)).blobs.length, 2);
    assert.match(await page.locator('[data-kw="relations"]').textContent(), /複查紀錄/);

    await page.locator('[data-kw="link-label"]').fill('待修網址');
    await page.locator('[data-kw="link-url"]').fill('javascript:alert(1)');
    await page.locator('[data-kw="link-save"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-kw="links"] li').length === 2);
    await page.locator('[data-kw="prepare"]').click();
    await page.waitForFunction(() => document.querySelector('[data-kw="links-error"]').textContent.includes('http://'));
    assert.equal((await snapshot(page)).outbox.length, 0);
    await page.locator('[data-edit-link]').last().click();
    await page.locator('[data-kw="link-url"]').fill('https://example.com/fixed');
    await page.locator('[data-kw="link-save"]').click();
    await page.waitForFunction(() => document.querySelector('[data-kw="links"]').textContent.includes('https://example.com/fixed'));
    await page.locator('[data-kw="prepare"]').click();
    await page.waitForFunction(() => document.querySelector('[data-kw="outbox-count"]').textContent === '1 筆');
    await page.locator('[data-kw="prepare"]').click();
    data = await snapshot(page);
    draft = data.drafts.find(item => item.draftId === a);
    assert.equal(data.outbox.length, 1);
    assert.equal(data.outbox[0].payloadRevision, draft.draftRevision);
    assert.equal(data.outbox[0].templateId, 'problem-solution');
    assert.equal(data.outbox[0].payload.images.length, 1);
    assert.equal(data.outbox[0].payload.attachments.length, 1);
    assert.equal(data.outbox[0].payload.links.length, 2);
    assert.equal(data.outbox[0].payload.relations[0].targetId, c);
    assert(!JSON.stringify(data.outbox[0]).includes('phase8 local attachment'));

    await context.setOffline(true);
    await page.locator('[data-remove-image]').click();
    await page.waitForFunction(() => !document.querySelector('.kw-image-card'));
    await page.locator('[data-remove-attachment]').click();
    await page.waitForFunction(() => !document.querySelector('[data-kw="attachments"] li'));
    await context.setOffline(false);
    data = await snapshot(page);
    draft = data.drafts.find(item => item.draftId === a);
    assert.equal(draft.images.length, 0);
    assert.equal(draft.attachments.length, 0);
    assert.equal(data.blobs.length, 0);
    assert.equal(data.outbox[0].payload.images.length, 0);
    assert.equal(data.outbox[0].payload.attachments.length, 0);
    assert.equal(data.outbox[0].payloadRevision, draft.draftRevision);
    assert(revisions.every((value, index) => index === 0 || value > revisions[index - 1]));

    await page.goto(`${base}/?open=knowledge-workbench&draft=${c}`);
    await page.locator('[data-kw="title"]').waitFor();
    await page.locator('[data-kw="delete"]').click();
    await page.waitForFunction(() => !new URL(location.href).searchParams.get('draft'));
    await page.goto(`${base}/?open=knowledge-workbench&draft=${a}`);
    await page.waitForFunction(() => document.querySelector('[data-kw="relations"]')?.textContent.includes('目標目前不可用'));
    assert.equal((await snapshot(page)).drafts.find(item => item.draftId === a).relations[0].targetId, c);
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, []);
    console.log('PASS: image preview/persist, attachment open/download, cleanup, links CRUD/validation, manual relation picker/identity/guards/missing target, outbox snapshot, offline, restart, mobile, no network writes or page errors');
  } finally {
    if (context) await context.close();
    const resolved = path.resolve(profile);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) await fs.rm(resolved, {recursive: true, force: true});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
