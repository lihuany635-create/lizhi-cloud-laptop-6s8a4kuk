// Regression checks with an isolated browser profile and deterministic local media.
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE || 'http://127.0.0.1:4186';
function wav() {
  const size = 8000*2*90, b = Buffer.alloc(44+size);
  b.write('RIFF'); b.writeUInt32LE(36+size,4); b.write('WAVEfmt ',8); b.writeUInt32LE(16,16);
  b.writeUInt16LE(1,20); b.writeUInt16LE(1,22); b.writeUInt32LE(8000,24); b.writeUInt32LE(16000,28); b.writeUInt16LE(2,32); b.writeUInt16LE(16,34); b.write('data',36); b.writeUInt32LE(size,40); return b;
}
(async()=>{
  const browser = await chromium.launch({headless:true,channel:'chrome'});
  const context = await browser.newContext({serviceWorkers:'block'});
  const page = await context.newPage(); const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/releases/download/**',r=>{
    const data=wav(), range=r.request().headers().range;
    if(range){const match=/bytes=(\d+)-(\d*)/.exec(range);const start=Number(match[1]),end=match[2]?Math.min(Number(match[2]),data.length-1):data.length-1;
      return r.fulfill({status:206,contentType:'audio/wav',headers:{'accept-ranges':'bytes','content-range':`bytes ${start}-${end}/${data.length}`},body:data.subarray(start,end+1)});}
    return r.fulfill({status:200,contentType:'audio/wav',headers:{'accept-ranges':'bytes'},body:data});
  });
  await context.route('https://drawing-codex-assistant.vercel.app/**',r=>r.fulfill({contentType:'text/html',body:'<textarea id="draft">test lesson</textarea>'}));
  await page.goto(base+'/?cloud=1&open=media');
  await page.waitForSelector('[data-player-element]');
  await page.evaluate(()=>{window.originalPlayer=document.querySelector('audio');});
  await page.locator('audio').first().evaluate(async el=>{await el.play();el.currentTime=22;});
  await page.getByRole('button',{name:'選擇收藏庫',exact:true}).click();
  await page.getByRole('button',{name:'關閉選單',exact:true}).click();
  assert(await page.evaluate(()=>document.querySelector('audio')===window.originalPlayer && !window.originalPlayer.paused));
  await page.getByPlaceholder('搜尋影音或 Podcast 名稱').fill('職場'); await page.waitForTimeout(300);
  assert(await page.evaluate(()=>document.querySelector('audio')===window.originalPlayer && !window.originalPlayer.paused));
  assert(await page.getByPlaceholder('搜尋影音或 Podcast 名稱').evaluate(el=>el===document.activeElement));
  await page.getByRole('button',{name:'清除',exact:true}).click();
  await page.locator('[data-favorite]').first().click();
  assert.equal(await page.locator('[data-favorite]').first().getAttribute('aria-pressed'),'true');
  await page.getByRole('button',{name:'選擇收藏庫',exact:true}).click();
  await page.locator('.nav-link[data-route="study"]').click();
  await page.frameLocator('#study-room-frame').locator('#draft').fill('未完成課程');
  await page.evaluate(()=>window.originalFrame=document.querySelector('#study-room-frame'));
  await page.getByRole('button',{name:'選擇收藏庫',exact:true}).click();
  await page.locator('.nav-link[data-route="media"]').click();
  await page.getByRole('button',{name:'選擇收藏庫',exact:true}).click();
  await page.locator('.nav-link[data-route="study"]').click();
  assert(await page.evaluate(()=>window.originalFrame===document.querySelector('#study-room-frame')));
  assert.equal(await page.frameLocator('#study-room-frame').locator('#draft').inputValue(),'未完成課程');
  assert(await page.evaluate(()=>!window.originalPlayer.paused));
  await page.evaluate(()=>window.originalPlayer.pause());
  const savedTime=await page.evaluate(()=>originalPlayer.currentTime);
  await page.goto(base+'/?cloud=1&open=media');
  await page.waitForSelector('audio');
  assert.equal(await page.locator('[data-favorite]').first().getAttribute('aria-pressed'),'true');
  await page.locator('audio').first().evaluate(el=>el.load());
  await page.waitForFunction(()=>document.querySelector('audio').readyState>=1);
  assert(savedTime>=22);
  assert(await page.locator('audio').first().evaluate((el,t)=>Math.abs(el.currentTime-t)<1,savedTime));
  console.log('PASS: menu/search/player identity, search focus, favorites, iframe state and playback resume');
  // Offline queuing and acknowledgments exercise application handlers with a simulated transport.
  await page.goto(base+'/?cloud=1&open=chat&room=RegressionTestRoom123456');
  await page.waitForSelector('.chat-compose textarea');
  await page.locator('.chat-compose textarea').fill('待傳文字'); await page.waitForTimeout(950);
  assert.equal(await page.locator('.chat-compose textarea').inputValue(),'');
  assert(await page.getByText('待傳送／等待接收確認',{exact:true}).count()>0);
  await page.reload(); await page.waitForSelector('.chat-message');
  assert(await page.getByText('待傳文字',{exact:true}).count()>0);
  await page.locator('.chat-compose textarea').evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})));
  await page.locator('.chat-compose textarea').fill('中文選字中'); await page.waitForTimeout(950);
  assert.equal(await page.locator('.chat-compose textarea').inputValue(),'中文選字中');
  await page.evaluate(()=>{receiveChatPacket({id:'remote-1',deviceId:'remote',deviceName:'test',createdAt:new Date().toISOString(),content:'遠端訊息'}, {open:true,send(){}},'test');});
  assert.equal(await page.locator('.chat-compose textarea').inputValue(),'中文選字中');
  await page.evaluate(()=>{window.packetCount=0;const connection={open:true,send(packet){window.packetCount++;receiveChatPacket({protocol:'lizhi-chat-v2',kind:'ack',id:packet.id,recipientId:'remote'},connection,'test');}};chat.connections.set('test',connection);flushChatOutbox();});
  assert(await page.getByText('對方裝置已收到',{exact:true}).count()>0);
  assert.equal(await page.evaluate(()=>chat.outbox.length),0);
  await page.evaluate(()=>receiveChatPacket({id:'remote-1',deviceId:'remote',createdAt:new Date().toISOString(),content:'遠端訊息'},{open:true,send(){}},'test'));
  assert.equal(await page.getByText('遠端訊息',{exact:true}).count(),1);
  await page.reload(); await page.waitForSelector('.chat-compose textarea');
  assert.equal(await page.locator('.chat-compose textarea').inputValue(),'中文選字中');
  console.log('PASS: durable queue, remote acknowledgment, duplicate suppression, draft persistence and IME');
  for(const viewport of [{width:390,height:844},{width:1024,height:600}]) {
    await page.setViewportSize(viewport);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const box=await page.locator('.chat-compose textarea').boundingBox(); assert(box.height>=95);
  }
  await page.goto(base+'/?cloud=1&open=uploads');
  await page.getByText('未發現待上傳影音',{exact:false}).waitFor();
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('PASS: portrait/landscape layout, upload status, no page errors');
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
