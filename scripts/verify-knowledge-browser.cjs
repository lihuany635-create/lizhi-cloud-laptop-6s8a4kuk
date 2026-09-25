const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.TEST_BASE||'http://127.0.0.1:4180';

(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  const online=await browser.newContext({serviceWorkers:'block'});
  const page=await online.newPage(),errors=[],vaultMethods=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(request.url().startsWith('http://127.0.0.1:8000/'))vaultMethods.push(request.method());});
  await page.goto(base+'/?open=knowledge');
  await page.getByText(/Vault 已連線/).waitFor({timeout:10000});
  assert(await page.locator('.vault-card').count()>0,'expected Vault cards');
  assert((await page.getByRole('heading',{name:'Obsidian Workflow'}).locator('xpath=following-sibling::*[1]').textContent()).includes('份'));
  await page.locator('[data-vault-path]').first().click();
  await page.locator('.vault-preview pre').waitFor();
  assert((await page.locator('.vault-preview pre').first().textContent()).trim().length>0,'expected lazy-loaded Vault content');
  await page.getByPlaceholder('搜尋本機與 Vault 知識').fill('歡迎使用立之雲端庫');
  await page.waitForTimeout(250);
  assert.equal(await page.getByRole('heading',{name:'歡迎使用立之雲端庫'}).count(),1);
  assert(vaultMethods.every(method=>method==='GET'),`Vault adapter sent a non-GET request: ${vaultMethods.join(',')}`);
  assert.equal(errors.length,0,errors.join('\n'));
  await online.close();

  const offline=await browser.newContext({serviceWorkers:'block'});
  await offline.route('http://127.0.0.1:8000/**',route=>route.abort('connectionrefused'));
  const offlinePage=await offline.newPage();
  await offlinePage.goto(base+'/?open=knowledge');
  await offlinePage.getByText(/Vault 未連線/).waitFor({timeout:12000});
  assert(await offlinePage.locator('.source-chip.local').count()>0,'local knowledge must remain visible offline');
  await offline.close();

  const cloud=await browser.newContext({serviceWorkers:'block'});
  const cloudPage=await cloud.newPage();
  await cloudPage.goto(base+'/?cloud=1&open=knowledge');
  await cloudPage.getByText(/Vault 僅限本機使用/).waitFor();
  await cloud.close();
  await browser.close();
  console.log('PASS: online Vault, lazy preview, local search, GET-only boundary, offline fallback and remote disable');
})().catch(error=>{console.error(error);process.exit(1);});
