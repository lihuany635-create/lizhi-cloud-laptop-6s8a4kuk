const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'lizhi-phase9-'));
  let context, secondBrowser;
  try {
    context = await chromium.launchPersistentContext(profile, {headless: true, channel: 'chrome', serviceWorkers: 'block'});
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    let record = null;
    let revision = 1;
    const token = 'short-lived-test-session';
    const gatewayRoute = async route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const headers = {'content-type': 'application/json', 'access-control-allow-origin': 'http://127.0.0.1:4187',
        'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'access-control-allow-headers': 'authorization, content-type, idempotency-key, x-asset-id, x-record-id, x-asset-sha256, x-asset-mime'};
      let status = 200, body = {};
      if (request.method() === 'OPTIONS') status = 204;
      else if (pathname === '/api/auth/session') {
        const input = JSON.parse(request.postData());
        if (input.writeSecret !== 'only-for-this-test') { status = 401; body = {error: 'invalid'}; }
        else body = {accessToken: token, expiresAt: new Date(Date.now() + 600_000).toISOString()};
      } else if (pathname === '/api/sync/snapshot') body = {manifest: {dataRevision: revision}, records: {items: record ? [{id: record.id, title: record.title, folderPath: record.folderPath, revision: record.revision}] : []}, trash: {items: []}};
      else if (pathname.startsWith('/api/records/') && request.method() === 'GET') {
        if (record) body = record;
        else {status = 404; body = {error: 'not found'};}
      } else if (pathname.startsWith('/api/records/') && request.method() === 'PUT') {
        assert.equal(request.headers().authorization, `Bearer ${token}`);
        assert.ok(request.headers()['idempotency-key']);
        const input = JSON.parse(request.postData());
        if (input.expectedRevision !== (record?.revision || 0)) {status = 409; body = {error: 'Record 版本衝突', currentRevision: record.revision};}
        else {
          record = {...input.record, revision: (record?.revision || 0) + 1, status: 'active'};
          revision++;
          body = {status: 'synced', record, dataRevision: revision};
        }
      } else {status = 404; body = {error: 'unexpected route'};}
      await route.fulfill({status, headers, body: status === 204 ? '' : JSON.stringify(body)});
    };
    await page.route('https://gateway.test/**', gatewayRoute);
    await page.goto('http://127.0.0.1:4187/?open=knowledge-workbench');
    await page.locator('[data-kw="new"]').click();
    await page.locator('[data-kw="folder-dialog"]').waitFor({state: 'visible'});
    await page.locator('[data-kw="folder-confirm"]').click();
    await page.locator('[data-kw="template-dialog"]').waitFor({state: 'visible'});
    await page.locator('[data-kw="template-confirm"]').click();
    await page.locator('[data-kw="title"]').fill('Phase 9 正式送出測試');
    await page.locator('[data-kw="body"]').fill('跨裝置資料');
    await page.waitForFunction(() => document.querySelector('[data-kw="save-status"]').textContent === '本機草稿已儲存');
    await page.locator('[data-kw="prepare"]').click();
    await page.waitForFunction(() => document.querySelector('[data-kw="outbox-count"]').textContent === '1 筆');
    await page.locator('[data-kw="gateway-url"]').fill('https://gateway.test/');
    await page.locator('[data-kw="gateway-save"]').click();
    await page.locator('[data-kw="write-secret"]').fill('only-for-this-test');
    await page.locator('[data-kw="authenticate"]').click();
    await page.waitForFunction(() => document.querySelector('[data-kw="send-status"]').textContent.includes('已驗證'));
    assert.equal(await page.locator('[data-kw="write-secret"]').inputValue(), '');
    assert.equal(await page.evaluate(() => localStorage.getItem('only-for-this-test')), null);
    await page.locator('[data-kw="send-pending"]').click();
    await page.waitForFunction(() => document.querySelector('[data-kw="send-status"]').textContent.includes('1 筆已同步'));
    assert.equal(record.title, 'Phase 9 正式送出測試');
    await page.locator('[data-kw="remote-list"] button').waitFor();
    assert.equal(await page.locator('[data-kw="remote-list"] button').count(), 1);
    await page.locator('[data-kw="title"]').fill('Phase 9 正式知識修訂');
    await page.waitForFunction(() => document.querySelector('[data-kw="save-status"]').textContent === '本機草稿已儲存');
    await page.locator('[data-kw="prepare"]').click();
    await page.locator('[data-kw="send-pending"]').click();
    await page.waitForFunction(() => document.querySelector('[data-kw="send-status"]').textContent.includes('1 筆已同步'));
    assert.equal(record.revision, 2);
    assert.equal(record.title, 'Phase 9 正式知識修訂');
    record = {...record, title: '另一裝置已更新', revision: 3};
    revision++;
    await page.locator('[data-kw="title"]').fill('本機後續修改');
    await page.waitForFunction(() => document.querySelector('[data-kw="save-status"]').textContent === '本機草稿已儲存');
    await page.locator('[data-kw="prepare"]').click();
    await page.locator('[data-kw="send-pending"]').click();
    await page.waitForFunction(() => document.querySelector('[data-kw="send-status"]').textContent.includes('版本衝突'));
    assert.equal(record.title, '另一裝置已更新');
    assert.equal(await page.evaluate(async () => {
      const {listOutbox} = await import('./knowledge-workbench/core/outbox-store.js');
      return (await listOutbox())[0].status;
    }), 'conflict');
    await page.reload();
    await page.locator('[data-kw="remote-list"] button').waitFor();
    assert.equal(await page.locator('[data-kw="remote-list"] button').count(), 1);
    await page.locator('[data-kw="remote-list"] button').click();
    await page.waitForFunction(() => document.querySelector('[data-kw="remote-status"]').textContent.includes('未覆蓋'));
    assert.equal(await page.locator('[data-kw="title"]').inputValue(), '本機後續修改');
    secondBrowser = await chromium.launch({headless: true, channel: 'chrome'});
    const other = await secondBrowser.newPage();
    await other.route('https://gateway.test/**', gatewayRoute);
    await other.goto('http://127.0.0.1:4187/?open=knowledge-workbench');
    await other.locator('[data-kw="gateway-url"]').fill('https://gateway.test/');
    await other.locator('[data-kw="gateway-save"]').click();
    await other.locator('[data-kw="remote-list"] button').waitFor();
    await other.locator('[data-kw="remote-list"] button').click();
    await other.waitForFunction(() => document.querySelector('[data-kw="remote-status"]').textContent.includes('本機編輯副本'));
    assert.equal(await other.locator('[data-kw="title"]').inputValue(), '另一裝置已更新');
    await other.locator('[data-kw="title"]').fill('第二裝置修訂');
    await other.waitForFunction(() => document.querySelector('[data-kw="save-status"]').textContent === '本機草稿已儲存');
    await other.locator('[data-kw="prepare"]').click();
    await other.locator('[data-kw="write-secret"]').fill('only-for-this-test');
    await other.locator('[data-kw="authenticate"]').click();
    await other.waitForFunction(() => document.querySelector('[data-kw="send-status"]').textContent.includes('已驗證'));
    await other.locator('[data-kw="send-pending"]').click();
    await other.waitForFunction(() => document.querySelector('[data-kw="send-status"]').textContent.includes('1 筆已同步'));
    assert.equal(record.title, '第二裝置修訂');
    assert.equal(record.revision, 4);
    assert.deepEqual(errors, []);
    console.log('PASS: local queue, short session, create/update, conflict protection, second-device import/edit, no page errors');
  } finally {
    if (secondBrowser) await secondBrowser.close();
    if (context) await context.close();
    if (path.dirname(path.resolve(profile)) !== path.resolve(os.tmpdir()) || !path.basename(profile).startsWith('lizhi-phase9-')) throw new Error('Refusing to remove unexpected test profile');
    await fs.rm(profile, {recursive: true, force: true});
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
