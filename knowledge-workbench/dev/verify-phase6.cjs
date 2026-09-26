const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const base = process.env.PHASE6_BASE || 'http://127.0.0.1:4187';
const custom = version => ({
  templateId: 'inspection-check', templateVersion: version, name: '驗收測試', status: 'active',
  sections: [
    {sectionId: 'first', title: '基本資料', fieldKeys: ['summary', 'quantity', 'kind']},
    {sectionId: 'second', title: '確認', fieldKeys: ['flags', 'approved', 'sourceUrl', ...(version === 2 ? ['extra'] : [])]},
  ],
  fields: [
    {key: 'summary', label: '摘要', type: 'text', required: true},
    {key: 'quantity', label: '數量', type: 'number'},
    {key: 'kind', label: '類別', type: 'select', options: ['A', 'B']},
    {key: 'flags', label: '標記', type: 'multiselect', options: ['RC', 'QA']},
    {key: 'approved', label: '已確認', type: 'checkbox'},
    {key: 'sourceUrl', label: '來源', type: 'url'},
    ...(version === 2 ? [{key: 'extra', label: '新增欄位', type: 'textarea'}] : []),
  ],
});

async function snapshot(page) {
  return page.evaluate(async () => {
    const {withTransaction, idbRequest, DB_VERSION} = await import('./knowledge-workbench/core/draft-db.js');
    return withTransaction(['drafts', 'outbox', 'meta'], 'readonly', async tx => ({
      version: DB_VERSION,
      stores: [...tx.db.objectStoreNames],
      drafts: await idbRequest(tx.objectStore('drafts').getAll()),
      outbox: await idbRequest(tx.objectStore('outbox').getAll()),
    }));
  });
}

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'lizhi-phase6-check-'));
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
    const unit = await page.evaluate(async ({v1, v2}) => {
      const schema = await import('./knowledge-workbench/core/template-schema.js');
      const registry = await import('./knowledge-workbench/core/template-registry.js');
      const values = await import('./knowledge-workbench/core/template-values.js');
      const form = await import('./knowledge-workbench/ui/template-form.js');
      const duplicate = {...v1, fields: [...v1.fields, v1.fields[0]]};
      const coreKey = {...v1, fields: [{key: 'title', label: '錯誤', type: 'text'}], sections: [{sectionId: 'main', title: '內容', fieldKeys: ['title']}]};
      const unknownType = {...v1, fields: [{key: 'x', label: '錯誤', type: 'magic'}], sections: [{sectionId: 'main', title: '內容', fieldKeys: ['x']}]};
      const reserved = {...v1, templateId: 'reserved-test', fields: [{key: 'picture', label: '圖片', type: 'image'}], sections: [{sectionId: 'main', title: '內容', fieldKeys: ['picture']}]};
      const validation = [schema.validateTemplateDefinition(v1).valid, schema.validateTemplateDefinition(duplicate).valid,
        schema.validateTemplateDefinition({...v1, templateVersion: 0}).valid, schema.validateTemplateDefinition(coreKey).valid,
        schema.validateTemplateDefinition(unknownType).valid, schema.validateTemplateDefinition(reserved).valid];
      registry.registerTemplate(v1);
      registry.registerTemplate(v2);
      registry.registerTemplate(reserved);
      const defaults = values.createDefaultFields(v1);
      const normalized = values.normalizeFields(v1, {...defaults, quantity: '', approved: 'yes', flags: ['RC'], legacyExtra: 'keep'});
      const oldOption = values.validateFields(v1, {...normalized, summary: 'ok', kind: 'removed'});
      const host = document.createElement('div');
      form.renderTemplateForm(host, reserved, {picture: {blobId: 'kept'}});
      const reservedValue = form.readTemplateFields(host, reserved, {picture: {blobId: 'kept'}});
      return {validation, versions: [registry.getTemplate('inspection-check', 1).templateVersion, registry.getTemplate('inspection-check', 2).templateVersion,
        registry.getLatestTemplate('inspection-check').templateVersion], activeCount: registry.listTemplates({status: 'active'}).length,
        defaults, normalized, oldOption: oldOption.errors.kind, reservedNotice: host.textContent, reservedValue};
    }, {v1: custom(1), v2: custom(2)});
    assert.deepEqual(unit.validation, [true, false, false, false, false, true]);
    assert.deepEqual(unit.versions, [1, 2, 2]);
    assert(unit.activeCount >= 3);
    assert.equal(unit.defaults.quantity, null);
    assert.equal(unit.defaults.approved, false);
    assert.deepEqual(unit.defaults.flags, []);
    assert.equal(unit.normalized.quantity, null);
    assert.equal(unit.normalized.approved, true);
    assert.equal(unit.normalized.legacyExtra, 'keep');
    assert.match(unit.oldOption, /選項已變更/);
    assert.match(unit.reservedNotice, /尚未啟用/);
    assert.deepEqual(unit.reservedValue.picture, {blobId: 'kept'});

    await page.locator('[data-kw="new"]').click();
    await page.locator('[data-kw="folder-confirm"]').click();
    await page.locator('[data-kw="template-dialog"]').waitFor({state: 'visible'});
    await page.locator('[data-kw="template-select"]').selectOption('inspection-check:1');
    await page.locator('[data-kw="template-confirm"]').click();
    await page.waitForURL(/draft=/);
    const id = new URL(page.url()).searchParams.get('draft');
    assert.equal(await page.locator('.kw-template-section h3').first().textContent(), '基本資料');
    assert.equal(await page.locator('.kw-template-section h3').last().textContent(), '確認');
    assert.deepEqual(await page.locator('[data-template-field]').evaluateAll(items => items.map(item => item.dataset.templateField)), ['summary', 'quantity', 'kind', 'flags', 'approved', 'sourceUrl']);
    await page.locator('[data-template-field="quantity"]').fill('');
    await page.locator('[data-template-field="sourceUrl"]').fill('not-a-url');
    await page.waitForFunction(() => document.querySelector('[data-kw="save-status"]').textContent === '本機草稿已儲存');
    let data = await snapshot(page);
    assert.equal(data.version, 1);
    assert.deepEqual(data.stores, ['blobs', 'drafts', 'meta', 'outbox']);
    assert.equal(data.drafts.find(draft => draft.draftId === id).fields.quantity, null);
    assert.equal(data.outbox.length, 0);
    await page.locator('[data-kw="prepare"]').click();
    await page.waitForFunction(() => document.querySelector('[data-field-error="summary"]').textContent.includes('必填'));
    assert.equal((await snapshot(page)).outbox.length, 0);
    await page.locator('[data-template-field="summary"]').fill('需要驗收');
    await page.waitForFunction(() => document.querySelector('[data-kw="save-status"]').textContent === '本機草稿已儲存');
    await page.locator('[data-kw="prepare"]').click();
    await page.waitForFunction(() => document.querySelector('[data-field-error="sourceUrl"]').textContent.includes('網址'));
    assert.equal((await snapshot(page)).outbox.length, 0);
    await page.locator('[data-template-field="sourceUrl"]').fill('https://example.com/source');
    await page.locator('[data-template-field="kind"]').selectOption('A');
    await page.locator('[data-template-field="flags"]').selectOption(['RC']);
    await page.locator('[data-template-field="approved"]').check();
    await page.locator('[data-kw="prepare"]').click();
    await page.waitForFunction(() => document.querySelector('[data-kw="outbox-count"]').textContent === '1 筆');
    data = await snapshot(page);
    const draft = data.drafts.find(item => item.draftId === id);
    assert.equal(draft.templateId, 'inspection-check');
    assert.equal(draft.templateVersion, 1);
    assert.deepEqual(draft.fields.flags, ['RC']);
    assert.equal(draft.fields.approved, true);
    assert.equal(data.outbox[0].payloadRevision, draft.draftRevision);
    assert.equal(data.outbox[0].templateId, 'inspection-check');
    assert.equal(data.outbox[0].templateVersion, 1);

    await page.locator('[data-template-field="summary"]').fill('');
    await page.waitForFunction(() => document.querySelector('[data-kw="save-status"]').textContent === '本機草稿已儲存');
    data = await snapshot(page);
    assert.equal(data.outbox[0].status, 'needs-review');
    assert.equal(data.outbox[0].payloadRevision, data.drafts.find(item => item.draftId === id).draftRevision);
    await page.locator('[data-template-field="summary"]').fill('已修正');
    await page.waitForFunction(() => document.querySelector('[data-kw="save-status"]').textContent === '本機草稿已儲存');
    assert.equal((await snapshot(page)).outbox[0].status, 'needs-review');
    await page.locator('[data-kw="prepare"]').click();
    await page.waitForFunction(() => document.querySelector('[data-kw="outbox-count"]').textContent === '1 筆');

    await context.setOffline(true);
    await page.locator('[data-template-field="summary"]').fill('離線修改');
    await page.waitForFunction(() => document.querySelector('[data-kw="save-status"]').textContent === '本機草稿已儲存');
    assert.equal((await snapshot(page)).drafts.find(item => item.draftId === id).fields.summary, '離線修改');
    await context.setOffline(false);
    await page.setViewportSize({width: 390, height: 844});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2), false);
    await page.locator('[data-template-field="kind"]').selectOption('B');
    await page.waitForFunction(() => document.querySelector('[data-kw="save-status"]').textContent === '本機草稿已儲存');
    assert.equal((await snapshot(page)).drafts.find(item => item.draftId === id).fields.kind, 'B');
    await page.setViewportSize({width: 1365, height: 850});

    const legacyId = await page.evaluate(async () => {
      const {createDraft} = await import('./knowledge-workbench/core/draft-store.js');
      const {withTransaction, idbRequest} = await import('./knowledge-workbench/core/draft-db.js');
      const draft = await createDraft();
      await withTransaction(['drafts'], 'readwrite', async tx => {
        const store = tx.objectStore('drafts');
        const raw = await idbRequest(store.get(draft.draftId));
        delete raw.templateId; delete raw.templateVersion; delete raw.fields;
        raw.content = '舊版內容保留';
        await idbRequest(store.put(raw));
      });
      return draft.draftId;
    });
    await page.goto(`${base}/?open=knowledge-workbench&draft=${legacyId}`);
    await page.waitForFunction(() => document.querySelector('[data-kw="body"]')?.value === '舊版內容保留');
    let legacy = (await snapshot(page)).drafts.find(item => item.draftId === legacyId);
    assert.equal(legacy.templateId, undefined);
    assert.equal(legacy.content, '舊版內容保留');
    await page.locator('[data-kw="title"]').fill('舊版修改');
    await page.waitForFunction(() => document.querySelector('[data-kw="save-status"]').textContent === '本機草稿已儲存');
    legacy = (await snapshot(page)).drafts.find(item => item.draftId === legacyId);
    assert.equal(legacy.templateId, 'general-note');
    assert.equal(legacy.templateVersion, 1);
    assert.equal(legacy.fields.body, '舊版內容保留');
    assert.equal(legacy.content, '舊版內容保留');

    const unknownId = await page.evaluate(async () => {
      const {createDraft, saveDraft} = await import('./knowledge-workbench/core/draft-store.js');
      const draft = await createDraft();
      await saveDraft({...draft, templateId: 'lost-template', templateVersion: 99, fields: {secret: 'must stay'}});
      return draft.draftId;
    });
    await page.goto(`${base}/?open=knowledge-workbench&draft=${unknownId}`);
    await page.waitForFunction(() => document.querySelector('.kw-template-warning')?.textContent.includes('找不到模板'));
    assert.match(await page.locator('.kw-template-raw').textContent(), /must stay/);
    await page.locator('[data-kw="title"]').fill('保留資料');
    await page.waitForFunction(() => document.querySelector('[data-kw="save-status"]').textContent === '本機草稿已儲存');
    assert.equal((await snapshot(page)).drafts.find(item => item.draftId === unknownId).fields.secret, 'must stay');
    await page.locator('[data-kw="prepare"]').click();
    assert.equal((await snapshot(page)).outbox.length, 1);

    await context.close();
    context = await chromium.launchPersistentContext(profile, {headless: true, channel: 'chrome', serviceWorkers: 'block', viewport: {width: 390, height: 844}});
    page = await context.newPage();
    watch(page);
    await page.goto(`${base}/?open=knowledge-workbench&draft=${legacyId}`);
    await page.waitForFunction(() => document.querySelector('[data-kw="body"]')?.value === '舊版內容保留');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2), false);
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, []);
    console.log('PASS: schema, versions, values, dynamic sections, autosave, validation, outbox identity, legacy, unknown fallback, offline, restart, mobile, no network writes or page errors');
  } finally {
    if (context) await context.close();
    const resolved = path.resolve(profile);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) await fs.rm(resolved, {recursive: true, force: true});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
