const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.TEST_BASE||'http://127.0.0.1:4180';
const apiBase='http://127.0.0.1:8000';

const definitions=[
  {type:'note',title:'Phase17 一般筆記驗收',summary:'一般筆記 round-trip',content:'由 Phase 17 統一編輯器契約產生。'},
  {type:'regulation',title:'Phase17 法規整理驗收',category:'法規',details:{source:'驗收來源',clauses:'第一條驗收條文',scenario:'Phase 17 測試',cautions:'不得直接寫 Vault',relatedWorkflow:'Phase17 施工流程驗收'}},
  {type:'quality',title:'Phase17 品質檢查驗收',category:'品質',details:{checkItems:'檢查安全寫入鏈',defects:'直接寫檔',improvements:'使用 Write Request',relatedWorkflow:'Phase17 施工流程驗收'}},
  {type:'experience',title:'Phase17 經驗紀錄驗收',details:{date:'2026-09-26',context:'Phase 17',event:'統一知識建立',handling:'安全 round-trip',result:'成功回讀',reflection:'維持 Vault 為 Source of Truth'}},
  {type:'solution',title:'Phase17 問題解法驗收',details:{problem:'如何從網站安全寫入',cause:'Backend 不可直接碰 Vault',attempts:'建立 Write Request',solution:'Sync Agent 與 VaultWriter',cautions:'衝突不得覆蓋'}},
  {type:'custom',title:'Phase17 自訂知識驗收',content:'自訂 Markdown round-trip。'}
];

(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome'}),context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();
  const writes=[];page.on('request',request=>{if(request.url().startsWith(apiBase)&&request.method()!=='GET')writes.push({method:request.method(),url:request.url()});});
  await page.goto(base+'/?open=knowledge');await page.getByText(/Vault 已連線/).waitFor({timeout:10000});

  async function api(path,options={}){
    return page.evaluate(async({url,options})=>{const response=await fetch(url,options);let body={};try{body=await response.json();}catch{}return {status:response.status,body};},{url:apiBase+path,options});
  }
  async function waitRequest(id){
    const deadline=Date.now()+60000;while(Date.now()<deadline){const result=await api(`/api/write-requests/${encodeURIComponent(id)}`);if(['applied','conflict','failed'].includes(result.body.status))return result.body;await new Promise(resolve=>setTimeout(resolve,500));}throw new Error(`request timeout: ${id}`);
  }
  async function waitNote(path,oldHash=''){
    const deadline=Date.now()+25000;while(Date.now()<deadline){const result=await api(`/api/note?path=${encodeURIComponent(path)}`);if(result.status===200&&result.body.contentHash&&result.body.contentHash!==oldHash)return result.body;await new Promise(resolve=>setTimeout(resolve,500));}throw new Error(`round-trip timeout: ${path}`);
  }
  async function submit(path,content,operation='create',baseHash=null){
    const result=await api('/api/write-requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path,content,operation,baseHash,source:'phase17-acceptance'})});
    assert.equal(result.status,200,JSON.stringify(result.body));return waitRequest(result.body.request.requestId);
  }
  async function serialize(definition){
    return page.evaluate(def=>{const draft=KnowledgeSerializer.createDraft({knowledgeType:def.type,title:def.title,category:def.category||'',tags:['Phase17','驗收'],summary:def.summary||'',content:def.content||'',details:def.details||{},path:`Phase17-Acceptance/${def.type}.md`});return KnowledgeSerializer.serialize(draft);},definition);
  }

  const serialized=[];
  for(const definition of definitions)serialized.push(await serialize(definition));
  const workflowPayload={title:'Phase17 施工流程驗收',category:'驗收',tags:['Phase17','Workflow'],description:'沿用 Phase 13 Serializer',path:'Phase17-Acceptance/workflow.md',diagrams:['flowchart TD\n  A[Draft] --> B[Write Request]\n  B --> C[VaultWriter]'],steps:[{title:'安全送出',description:'建立 Write Request',checkItems:['不得直接寫檔']}],qualityChecklist:[{text:'完成 round-trip',checked:false}],notes:['衝突不得覆蓋']};
  const workflow=await api('/api/workflow/serialize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(workflowPayload)});assert.equal(workflow.status,200,JSON.stringify(workflow.body));serialized.push(workflow.body);

  const created=[];
  for(const item of serialized){
    const existing=await api(`/api/note?path=${encodeURIComponent(item.suggestedPath)}`);
    if(existing.status===404){const request=await submit(item.suggestedPath,item.markdown);assert.equal(request.status,'applied',JSON.stringify(request));created.push(item.suggestedPath);}
    await waitNote(item.suggestedPath);
  }

  const target=serialized[0],before=await waitNote(target.suggestedPath),oldHash=before.contentHash;
  const nextSentence=before.content.includes('並完成 Update round-trip。')?'由 Phase 17 統一編輯器契約產生。':'由 Phase 17 統一編輯器契約產生，並完成 Update round-trip。';
  const updatedMarkdown=target.markdown.replace('由 Phase 17 統一編輯器契約產生。',nextSentence);
  const update=await submit(target.suggestedPath,updatedMarkdown,'update',oldHash);assert.equal(update.status,'applied',JSON.stringify(update));
  const after=await waitNote(target.suggestedPath,oldHash);assert.notEqual(after.contentHash,oldHash);

  const duplicate=await submit(target.suggestedPath,target.markdown,'create',null);assert.equal(duplicate.status,'conflict',JSON.stringify(duplicate));
  const stale=await submit(target.suggestedPath,target.markdown+'\nStale edit must not be applied.\n','update',oldHash);assert.equal(stale.status,'conflict',JSON.stringify(stale));
  const workflows=await api('/api/workflows');assert((workflows.body.workflows||[]).some(item=>item.path==='Phase17-Acceptance/workflow.md'));
  const pending=await api('/api/write-requests?status=pending'),processing=await api('/api/write-requests?status=processing');assert.equal(pending.body.count,0);assert.equal(processing.body.count,0);
  assert(writes.every(entry=>entry.method==='POST'&&(entry.url.endsWith('/api/write-requests')||entry.url.endsWith('/api/workflow/serialize'))),JSON.stringify(writes));
  await context.close();await browser.close();
  console.log(`PASS: seven knowledge types round-trip; update hash changed; duplicate/stale conflicts protected; created=${created.length}`);
})().catch(error=>{console.error(error);process.exit(1);});
