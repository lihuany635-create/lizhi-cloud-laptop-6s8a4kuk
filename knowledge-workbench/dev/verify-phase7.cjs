const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const base = process.env.PHASE7_BASE || 'http://127.0.0.1:4187';
const sample = {
  occurredOn: '2026-09-26',
  issue: '拆模後局部骨材外露並出現蜂窩。',
  context: '澆置當日泵送施工，牆厚較大。',
  location: 'B1 外牆 A 區',
  relatedQuestions: '同區段是否有類似缺失？',
  possibleCauses: '振動不足、模板漏漿、鋼筋過密。',
  confirmedCause: '',
  analysisNotes: '需比對施工與檢查紀錄。',
  solution: '記錄缺失位置，依程序確認修補範圍與工法。',
  steps: '1. 拍照\n2. 標記位置\n3. 確認深度\n4. 建立後續處理紀錄',
  resources: '相機、檢查表',
  outcome: '待複查',
  isResolved: false,
  followUp: '安排下一次現場確認',
  sourceUrl: 'https://example.com/reference',
  notes: '此為本機驗收樣本',
};
const keys = Object.keys(sample);

async function snapshot(page) {
  return page.evaluate(async () => {
    const {withTransaction, idbRequest, DB_VERSION} = await import('./knowledge-workbench/core/draft-db.js');
    return withTransaction(['drafts', 'outbox'], 'readonly', async tx => ({
      version: DB_VERSION,
      stores: [...tx.db.objectStoreNames],
      drafts: await idbRequest(tx.objectStore('drafts').getAll()),
      outbox: await idbRequest(tx.objectStore('outbox').getAll()),
    }));
  });
}

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'lizhi-phase7-check-'));
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
    const definition = await page.evaluate(async () => {
      const registry = await import('./knowledge-workbench/core/template-registry.js');
      const schema = await import('./knowledge-workbench/core/template-schema.js');
      const template = registry.getTemplate('problem-solution', 1);
      return {template, valid: schema.validateTemplateDefinition(template),
        active: registry.listTemplates({status: 'active'}).map(item => item.templateId),
        general: Boolean(registry.getTemplate('general-note', 1))};
    });
    assert(definition.valid.valid);
    assert.equal(definition.template.templateId, 'problem-solution');
    assert.equal(definition.template.templateVersion, 1);
    assert.equal(definition.template.fields.length, 16);
    assert.deepEqual(definition.template.fields.filter(field => field.required).map(field => field.key), ['issue', 'solution']);
    assert.deepEqual(definition.template.sections.map(section => section.title), ['問題', '分析', '處理', '結果', '補充']);
    assert.deepEqual(definition.template.fields.map(field => field.key), keys);
    assert(definition.active.includes('problem-solution'));
    assert(definition.general);

    await page.locator('[data-kw="new"]').click();
    await page.locator('[data-kw="folder-dialog"]').waitFor({state: 'visible'});
    assert.equal((await snapshot(page)).drafts.length, 0);
    await page.locator('[data-kw="folder-name"]').fill('工程/RC/施工問題');
    await page.locator('[data-kw="folder-create"]').click();
    await page.waitForFunction(() => document.querySelector('[data-kw="picker-crumb"]').textContent.includes('施工問題'));
    await page.locator('[data-kw="folder-confirm"]').click();
    await page.locator('[data-kw="template-dialog"]').waitFor({state: 'visible'});
    const options = await page.locator('[data-kw="template-select"] option').evaluateAll(items => items.map(item => item.value));
    assert(options.includes('problem-solution:1'));
    await page.locator('[data-kw="template-select"]').selectOption('problem-solution:1');
    await page.locator('[data-kw="template-confirm"]').click();
    await page.waitForURL(/draft=/);
    const id = new URL(page.url()).searchParams.get('draft');
    assert.equal(await page.locator('[data-kw="template-meta"]').textContent(), '問題／解法 · v1');
    assert.deepEqual(await page.locator('.kw-template-section h3').allTextContents(), ['問題', '分析', '處理', '結果', '補充']);
    assert.deepEqual(await page.locator('[data-template-field]').evaluateAll(items => items.map(item => item.dataset.templateField)), keys);
    assert.equal((await snapshot(page)).drafts[0].folderPath, '工程/RC/施工問題');

    await page.locator('[data-kw="prepare"]').click();
    await page.waitForFunction(() => document.querySelector('[data-field-error="issue"]').textContent.includes('必填'));
    assert.match(await page.locator('[data-field-error="solution"]').textContent(), /必填/);
    assert.equal((await snapshot(page)).outbox.length, 0);

    await page.locator('[data-kw="title"]').fill('地下室牆面拆模後出現蜂窩');
    await page.locator('[data-kw="tags"]').fill('RC, 混凝土, 缺失');
    for (const [key, value] of Object.entries(sample)) {
      if (key === 'isResolved') continue;
      await page.locator(`[data-template-field="${key}"]`).fill(value);
    }
    await page.waitForFunction(() => document.querySelector('[data-kw="save-status"]').textContent === '本機草稿已儲存');
    let data = await snapshot(page);
    let draft = data.drafts.find(item => item.draftId === id);
    assert.equal(data.version, 1);
    assert.deepEqual(data.stores, ['blobs', 'drafts', 'meta', 'outbox']);
    assert.equal(draft.templateId, 'problem-solution');
    assert.equal(draft.templateVersion, 1);
    assert.equal(draft.folderPath, '工程/RC/施工問題');
    assert.deepEqual(draft.tags, ['RC', '混凝土', '缺失']);
    assert.deepEqual(draft.fields, sample);
    assert(draft.draftRevision > 2);
    assert.equal(data.outbox.length, 0);

    await page.reload();
    await page.waitForFunction(() => document.querySelector('[data-template-field="issue"]')?.value === '拆模後局部骨材外露並出現蜂窩。');
    assert.equal(await page.locator('[data-template-field="steps"]').inputValue(), sample.steps);
    assert.equal(await page.locator('[data-kw="template-meta"]').textContent(), '問題／解法 · v1');
    assert.deepEqual((await snapshot(page)).drafts.find(item => item.draftId === id).fields, sample);

    await context.setOffline(true);
    await page.locator('[data-template-field="outcome"]').fill('離線複查中');
    await page.locator('[data-template-field="followUp"]').fill('離線新增追蹤事項');
    await page.waitForFunction(() => document.querySelector('[data-kw="save-status"]').textContent === '本機草稿已儲存');
    data = await snapshot(page);
    assert.equal(data.drafts.find(item => item.draftId === id).fields.outcome, '離線複查中');
    await context.setOffline(false);

    await page.locator('[data-template-field="solution"]').fill('');
    await page.waitForFunction(() => document.querySelector('[data-kw="save-status"]').textContent === '本機草稿已儲存');
    await page.locator('[data-kw="prepare"]').click();
    await page.waitForFunction(() => document.querySelector('[data-field-error="solution"]').textContent.includes('必填'));
    assert.equal((await snapshot(page)).outbox.length, 0);
    await page.locator('[data-template-field="solution"]').fill(sample.solution);
    await page.locator('[data-template-field="sourceUrl"]').fill('not-a-url');
    await page.waitForFunction(() => document.querySelector('[data-kw="save-status"]').textContent === '本機草稿已儲存');
    await page.locator('[data-kw="prepare"]').click();
    await page.waitForFunction(() => document.querySelector('[data-field-error="sourceUrl"]').textContent.includes('網址'));
    assert.equal((await snapshot(page)).outbox.length, 0);
    await page.locator('[data-template-field="sourceUrl"]').fill(sample.sourceUrl);
    await page.locator('[data-kw="prepare"]').click();
    await page.waitForFunction(() => document.querySelector('[data-kw="outbox-count"]').textContent === '1 筆');
    await page.locator('[data-kw="prepare"]').click();
    data = await snapshot(page);
    draft = data.drafts.find(item => item.draftId === id);
    assert.equal(data.outbox.length, 1);
    assert.equal(data.outbox[0].status, 'queued');
    assert.equal(data.outbox[0].draftId, id);
    assert.equal(data.outbox[0].templateId, 'problem-solution');
    assert.equal(data.outbox[0].templateVersion, 1);
    assert.equal(data.outbox[0].payloadRevision, draft.draftRevision);

    const guard = await page.evaluate(async draftId => {
      const store = await import('./knowledge-workbench/core/draft-store.js');
      const stale = await store.getDraft(draftId);
      await store.saveDraft({...stale, title: '較新的標題'});
      try { await store.saveDraft({...stale, title: '不應覆蓋'}); return false; }
      catch { return (await store.getDraft(draftId)).title === '較新的標題'; }
    }, id);
    assert(guard);

    await context.close();
    context = await chromium.launchPersistentContext(profile, {headless: true, channel: 'chrome', serviceWorkers: 'block', viewport: {width: 390, height: 844}});
    page = await context.newPage();
    watch(page);
    await page.goto(`${base}/?open=knowledge-workbench`);
    await page.locator('.kw-draft-card').first().waitFor();
    await page.locator('.kw-draft-card').first().click();
    await page.waitForFunction(() => document.querySelector('[data-template-field="issue"]')?.value === '拆模後局部骨材外露並出現蜂窩。');
    assert.equal(await page.locator('[data-template-field="outcome"]').inputValue(), '離線複查中');
    assert.deepEqual((await snapshot(page)).drafts.find(item => item.draftId === id).fields,
      {...sample, outcome: '離線複查中', followUp: '離線新增追蹤事項'});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2), false);
    await page.locator('[data-template-field="location"]').fill('B1 外牆 A 區（手機補充）');
    await page.waitForFunction(() => document.querySelector('[data-kw="save-status"]').textContent === '本機草稿已儲存');
    assert.equal((await snapshot(page)).drafts.find(item => item.draftId === id).fields.location, 'B1 外牆 A 區（手機補充）');

    const fallback = await page.evaluate(async () => {
      const store = await import('./knowledge-workbench/core/draft-store.js');
      const legacy = await store.createDraft();
      await store.saveDraft({...legacy, fields: {body: '一般筆記保留'}});
      const unknown = await store.createDraft();
      await store.saveDraft({...unknown, templateId: 'problem-solution', templateVersion: 99, fields: {issue: '未知版本原值'}});
      return {legacyId: legacy.draftId, unknownId: unknown.draftId};
    });
    await page.goto(`${base}/?open=knowledge-workbench&draft=${fallback.legacyId}`);
    await page.waitForFunction(() => document.querySelector('[data-kw="body"]')?.value === '一般筆記保留');
    await page.goto(`${base}/?open=knowledge-workbench&draft=${fallback.unknownId}`);
    await page.waitForFunction(() => document.querySelector('.kw-template-warning')?.textContent.includes('找不到模板'));
    assert.match(await page.locator('.kw-template-raw').textContent(), /未知版本原值/);
    assert.equal((await snapshot(page)).drafts.find(item => item.draftId === fallback.unknownId).fields.issue, '未知版本原值');
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, []);
    console.log('PASS: registration, schema, dynamic 16 fields, required, autosave, refresh/restart, offline, URL, outbox dedup, revision guard, legacy/unknown, mobile, no network writes or page errors');
  } finally {
    if (context) await context.close();
    const resolved = path.resolve(profile);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) await fs.rm(resolved, {recursive: true, force: true});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
