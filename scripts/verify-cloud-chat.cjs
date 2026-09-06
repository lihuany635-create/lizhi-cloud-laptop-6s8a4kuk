const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.TEST_BASE || 'http://127.0.0.1:4186';
const live = process.env.LIVE_CHAT === '1';
const records = new Map();
let rejectWrites = false;
const stamp = Date.now();
async function waitFor(page, predicate) { await page.waitForFunction(predicate, null, {timeout:35000}); }
(async () => {
  const browser = await chromium.launch({headless:true,channel:'chrome'});
  try {
    const errors = [];
    async function device(room, width=1280, height=900) {
      const ctx = await browser.newContext({serviceWorkers:'block',viewport:{width,height}});
      if (!live) {
        await ctx.route('https://dtgtkrlzufylyvcbgggw.supabase.co/rest/v1/**', async route => {
          const request=route.request(), url=new URL(request.url());
          const reply=data=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
          if (request.method()==='POST') {
            if (rejectWrites) return route.fulfill({status:503,contentType:'application/json',body:'{}'});
            const body=request.postDataJSON();
            if (!records.has(body.p_id)) records.set(body.p_id,{id:body.p_id,device_id:body.p_device_id,device_name:body.p_device_name,content:body.p_content,created_at:new Date().toISOString()});
            return reply(records.get(body.p_id));
          }
          const rows=[...records.values()].sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,Number(url.searchParams.get('limit')));
          return reply(url.searchParams.get('select')==='id'?rows.map(r=>({id:r.id})):rows);
        });
        await ctx.addInitScript(({room})=>{
          localStorage.setItem('lizhi-realtime-room',room);
          localStorage.setItem('lizhi-realtime-history:'+room,JSON.stringify([{id:'legacy',content:'舊私人紀錄不可自動公開'}]));
        },{room});
      }
      const page=await ctx.newPage(); page.on('pageerror',e=>errors.push(e.message));
      await page.goto(base+'/?open=chat&room='+room);
      await waitFor(page,()=>chat.status==='online');
      assert.equal(await page.locator('.chat-pairing,.chat-share').count(),0);
      assert.equal(await page.locator('script[src*="peerjs"]').count(),0);
      return {ctx,page};
    }
    const first=await device('PreviouslyDifferentRoomA');
    const second=await device('PreviouslyDifferentRoomB',390,844);
    const text=`${live?'共用對話功能驗證':'測試'}：自動同步 ${stamp}`;
    await first.page.getByLabel('要傳送的文字').fill(text);
    await second.page.getByText(text,{exact:true}).waitFor({timeout:35000});
    await waitFor(first.page,()=>chat.outbox.length===0);
    assert(await first.page.getByText('已存到雲端',{exact:true}).count()>0);
    assert.equal(await first.page.getByLabel('要傳送的文字').inputValue(),'');
    // Duplicate acknowledgment must not duplicate the server's stored row.
    if (live) {
      const result=await first.page.evaluate(async text=>{
        const m=chat.messages.find(m=>m.content===text);
        const body={p_id:m.id,p_device_id:m.deviceId,p_device_name:m.deviceName,p_content:m.content};
        await chatRequest('/rpc/lizhi_send_message',body);
        return (await chatRequest('/lizhi_cloud_messages?select=id&id=eq.'+m.id)).length;
      },text);
      assert.equal(result,1);
    }
    await first.ctx.close();
    const third=await device('PreviouslyDifferentRoomC',1024,600);
    await third.page.getByText(text,{exact:true}).waitFor();
    console.log('PASS: same site/no pairing, automatic send, mobile receive, history after sender closes');
    if (!live) {
      assert(![...records.values()].some(m=>m.content.includes('舊私人')));
      // Keep locally queued messages through a reload while backend is unavailable.
      rejectWrites=true;
      await second.page.getByLabel('要傳送的文字').fill('離線待傳');
      await second.page.getByText('待上傳 · 已保存在此裝置',{exact:true}).waitFor();
      await second.page.reload();
      await second.page.getByText('離線待傳',{exact:true}).waitFor();
      rejectWrites=false;
      await second.page.evaluate(()=>retryChatConnection());
      await third.page.getByText('離線待傳',{exact:true}).waitFor({timeout:35000});
      await waitFor(second.page,()=>chat.outbox.length===0);
      // IME drafts survive background synchronization and reload.
      const input=second.page.getByLabel('要傳送的文字');
      await input.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})));
      await input.fill('中文選字草稿'); await second.page.waitForTimeout(1000);
      assert.equal(await input.inputValue(),'中文選字草稿');
      await third.page.getByLabel('要傳送的文字').fill('<img src=x onerror=alert(1)>');
      await second.page.getByText('<img src=x onerror=alert(1)>',{exact:true}).waitFor({timeout:35000});
      assert.equal(await input.inputValue(),'中文選字草稿');
      assert.equal(await second.page.locator('.chat-message img').count(),0);
      await second.page.reload();
      await second.page.getByLabel('要傳送的文字').waitFor();
      assert.equal(await second.page.getByLabel('要傳送的文字').inputValue(),'中文選字草稿');
      assert.equal([...records.values()].filter(m=>m.content==='離線待傳').length,1);
      await waitFor(third.page,()=>!chat.syncBusy);
      await third.page.evaluate(()=>window.savedMessages=document.querySelector('.chat-messages').firstElementChild);
      await third.page.evaluate(()=>syncCloudChat());
      assert(await third.page.evaluate(()=>window.savedMessages===document.querySelector('.chat-messages').firstElementChild));
      console.log('PASS: durable pending queue/reload/retry/dedup, no private-history migration, IME/drafts, XSS escape, stable DOM');
    }
    for (const page of [second.page,third.page]) {
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      const box=await page.getByLabel('要傳送的文字').boundingBox(); assert(box.height>=80);
    }
    assert.deepEqual(errors,[]);
    console.log('PASS: portrait/landscape input usable, no JavaScript errors'+(live?' (LIVE CLOUD)':''));
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exit(1)});
