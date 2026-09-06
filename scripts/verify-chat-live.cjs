const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE || 'http://127.0.0.1:4186';
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const a=await browser.newContext({serviceWorkers:'block'}),b=await browser.newContext({serviceWorkers:'block'});
    const sender=await a.newPage(),receiver=await b.newPage();
    const url=base+'/?cloud=1&open=chat&room=QA'+require('node:crypto').randomBytes(18).toString('hex');
    await sender.goto(url);
    await sender.waitForSelector('.chat-compose textarea');
    await sender.locator('textarea').fill('連線前的測試文字');
    await sender.waitForTimeout(1100);
    await receiver.goto(url);
    await receiver.getByText('連線前的測試文字',{exact:true}).waitFor({timeout:45000});
    await sender.getByText('對方裝置已收到',{exact:true}).waitFor({timeout:15000});
    await b.setOffline(true);
    await sender.locator('textarea').fill('恢復網路後補傳');
    await sender.waitForTimeout(1100);
    await b.setOffline(false);
    await receiver.reload();
    await receiver.getByText('恢復網路後補傳',{exact:true}).waitFor({timeout:45000});
    await sender.waitForFunction(()=>chat.outbox.length===0,{},{timeout:15000});
    assert.equal(await receiver.getByText('恢復網路後補傳',{exact:true}).count(),1);
    console.log('PASS: actual PeerJS/WebRTC, queued-before-connect delivery, reconnect and acknowledgment');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1});
