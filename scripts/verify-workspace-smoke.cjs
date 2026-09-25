const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.TEST_BASE||'http://127.0.0.1:4180';
const routes=['home','knowledge','weave','finance','media','chat','study','a4','uploads','trash','settings'];

(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  const context=await browser.newContext({serviceWorkers:'block'});
  await context.route('https://dtgtkrlzufylyvcbgggw.supabase.co/**',route=>route.fulfill({contentType:'application/json',body:'[]'}));
  await context.route('https://drawing-codex-assistant.vercel.app/**',route=>route.fulfill({contentType:'text/html',body:'<p>study smoke</p>'}));
  for(const route of routes){
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`${base}/?open=${route}`,{waitUntil:'domcontentloaded'});
    await page.locator(`.shell.route-${route}`).waitFor({timeout:10000});
    assert.equal(errors.length,0,`${route}: ${errors.join('; ')}`);
    await page.close();
  }
  await browser.close();
  console.log(`PASS: workspace smoke (${routes.join(', ')})`);
})().catch(error=>{console.error(error);process.exit(1);});
