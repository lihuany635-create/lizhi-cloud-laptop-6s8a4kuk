(function(global){
  "use strict";

  const DRAFT_KEY="lizhi-phase17-knowledge-draft";
  let service=null,rerender=()=>{},draft=null,initial="",preview=null,status="",busy=false,conflict=false,previewTimer=null,previewRevision=0,mermaidModule=null;
  const esc=value=>String(value??"").replace(/[&<>'"]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char]);
  const snapshot=value=>JSON.stringify(value);
  const isDirty=()=>!!draft&&snapshot(draft)!==initial;
  const persist=()=>{try{draft?sessionStorage.setItem(DRAFT_KEY,JSON.stringify(draft)):sessionStorage.removeItem(DRAFT_KEY);}catch{}}

  function configure(options){service=options.service;rerender=options.rerender||rerender;}
  function restore(){try{const saved=JSON.parse(sessionStorage.getItem(DRAFT_KEY)||"null");if(saved?.title||saved?.content){draft=saved;initial="";status="已恢復尚未送出的草稿";schedulePreview();return true;}}catch{}return false;}
  function openCreate(){draft=KnowledgeSerializer.createDraft();initial=snapshot(draft);preview=null;status="";conflict=false;persist();rerender();schedulePreview();}
  function openLocal(){draft=KnowledgeSerializer.createDraft({source:"local",knowledgeType:"note"});initial=snapshot(draft);preview=null;status="";conflict=false;persist();rerender();schedulePreview();}
  async function openVault(path){
    status="正在讀取 Vault 最新版本…";busy=true;rerender();
    try{
      const item=await service.loadVaultItem(path);
      draft=item.kind==="workflow"?await workflowDraft(item):KnowledgeSerializer.fromVault(item);
      initial=snapshot(draft);preview=null;status="";conflict=false;persist();schedulePreview();
    }catch(error){status=`讀取失敗：${error.message}`;}finally{busy=false;rerender();}
  }
  async function workflowDraft(item){
    const workflow=await service.loadWorkflow(item.path);
    return KnowledgeSerializer.createDraft({mode:"update",source:"vault",knowledgeType:"workflow",title:workflow.title||item.title,category:workflow.category||workflow.metadata?.category||"",tags:workflow.tags||workflow.metadata?.tags||[],summary:workflow.description||"",path:item.path,contentHash:item.contentHash,workflow:{diagrams:(workflow.diagrams||[]).join("\n\n"),steps:(workflow.steps||[]).map(step=>[step.title,step.description,(step.checkItems||[]).join(";")].join("｜")).join("\n"),quality:(workflow.qualityChecklist||[]).map(entry=>entry.text||entry).join("\n"),notes:(workflow.notes||[]).join("\n"),status:workflow.metadata?.status||"",relatedRegulations:(workflow.relatedRegulations||[]).join("\n"),relatedNotes:(workflow.relatedNotes||[]).join("\n"),photos:(workflow.photos||[]).map(entry=>entry.raw||entry.target||entry).join("\n")}});
  }

  function field(name,label,value,type="input",help=""){
    const control=type==="textarea"?`<textarea name="${name}" rows="5">${esc(value)}</textarea>`:`<input name="${name}" value="${esc(value)}">`;
    return `<label><span>${label}${help?` <small>${esc(help)}</small>`:""}</span>${control}</label>`;
  }
  function typeFields(){
    if(draft.knowledgeType==="workflow")return `${field("workflow.status","狀態",draft.workflow?.status)}${field("workflow.diagrams","Mermaid 流程圖",draft.workflow?.diagrams,"textarea")}${field("workflow.steps","施工步驟",draft.workflow?.steps,"textarea","每行：標題｜說明｜檢查1;檢查2")}${field("workflow.quality","品質檢核",draft.workflow?.quality,"textarea","每行一項")}${field("workflow.notes","施工注意事項",draft.workflow?.notes,"textarea","每行一項")}${field("workflow.relatedRegulations","相關法規",draft.workflow?.relatedRegulations,"textarea","每行一項")}${field("workflow.relatedNotes","相關筆記",draft.workflow?.relatedNotes,"textarea","每行一項")}${field("workflow.photos","現場照片",draft.workflow?.photos,"textarea","每行一項")}`;
    const sections=KnowledgeSerializer.detailSections[draft.knowledgeType];
    if(sections)return sections.map(([key,label])=>field(`details.${key}`,label,draft.details?.[key],"textarea")).join("");
    return field("content","內容",draft.content,"textarea");
  }
  function render(){
    if(!draft)return "";
    const online=service?.current().vaultStatus==="online",canSave=draft.source==="local"||online;
    return `<div class="knowledge-editor-backdrop"><section class="knowledge-editor" role="dialog" aria-modal="true" aria-label="知識編輯器">
      <header><div><div class="eyebrow">UNIFIED KNOWLEDGE EDITOR</div><h2>${draft.mode==="create"?"新增知識":"編輯 Vault 知識"}</h2></div><button class="icon-button" data-editor-action="close" aria-label="關閉編輯器">×</button></header>
      <div class="editor-status ${status.includes("失敗")||status.includes("衝突")?"error":""}" role="status">${esc(status||((draft.source==="vault"&&!online)?"Vault 未連線，草稿會保留但不能送出":""))}</div>
      ${conflict?`<div class="editor-conflict-actions"><button type="button" class="button" data-editor-action="keep-draft">保留我的草稿</button><button type="button" class="button" data-editor-action="reload-vault">重新載入 Vault 最新版本</button></div>`:""}
      <form data-knowledge-editor-form><div class="editor-columns"><fieldset class="editor-fields" ${draft.pendingRequestId?"disabled":""}>
        <div class="editor-row"><label><span>儲存來源</span><select name="source" ${draft.mode==="update"?"disabled":""}><option value="vault" ${draft.source==="vault"?"selected":""}>Obsidian Vault</option><option value="local" ${draft.source==="local"?"selected":""}>本機筆記</option></select></label><label><span>知識類型</span><select name="knowledgeType" ${draft.source==="local"||draft.mode==="update"&&draft.knowledgeType==="workflow"?"disabled":""}>${KnowledgeSerializer.TYPES.map(([value,label])=>`<option value="${value}" ${draft.knowledgeType===value?"selected":""}>${label}</option>`).join("")}</select></label></div>
        ${field("title","標題",draft.title)}${draft.mode==="update"?`<p class="vault-path">Vault 路徑：${esc(draft.path)}</p>`:field("path","Vault 路徑",draft.path||KnowledgeSerializer.pathFor(draft),"input","相對路徑，必須以 .md 結尾")}
        <div class="editor-row">${field("category","分類",draft.category)}${field("tags","標籤",(draft.tags||[]).join(", "),"input","以逗號分隔")}</div>
        ${field("summary","摘要",draft.summary,"textarea")}${typeFields()}
      </fieldset><aside class="editor-preview"><h3>Markdown 預覽</h3><pre>${esc(preview?.markdown||"填寫內容後會自動產生預覽")}</pre>${draft.knowledgeType==="workflow"?`<h3>Mermaid 預覽</h3><div class="mermaid-preview" data-mermaid-preview>輸入流程圖後顯示圖形預覽</div><details><summary>查看 Mermaid 原始碼</summary><pre data-mermaid-source>${esc(draft.workflow?.diagrams)}</pre></details>`:""}</aside></div>
      <footer><button type="button" class="button" data-editor-action="close">取消</button><span>${isDirty()?"有未儲存修改":"尚未修改"}</span><button type="submit" class="button primary" ${busy||!canSave||conflict?"disabled":""}>${busy?"處理中…":draft.pendingRequestId?"查詢同一筆寫入請求":draft.source==="local"?"儲存本機筆記":"送出安全寫入"}</button></footer></form></section></div>`;
  }

  function setPath(object,path,value){const parts=path.split(".");let cursor=object;while(parts.length>1){const key=parts.shift();cursor[key]??={};cursor=cursor[key];}cursor[parts[0]]=value;}
  function update(target){
    if(!draft||!target.name||draft.pendingRequestId)return;
    const value=target.name==="tags"?target.value.split(",").map(item=>item.trim()).filter(Boolean):target.value;
    setPath(draft,target.name,value);
    if(target.name==="title"&&draft.mode==="create"&&!draft.path)draft.path=KnowledgeSerializer.pathFor(draft);
    if(target.name==="source"&&value==="local")draft.knowledgeType="note";
    persist();schedulePreview();
  }
  function schedulePreview(){clearTimeout(previewTimer);previewRevision++;previewTimer=setTimeout(()=>generatePreview(previewRevision),220);}
  async function generatePreview(revision){
    if(!draft)return;
    const current=snapshot(draft);
    try{const result=draft.knowledgeType==="workflow"?await service.serializeWorkflow(KnowledgeSerializer.workflowPayload(draft)):KnowledgeSerializer.serialize(draft);if(revision!==previewRevision||current!==snapshot(draft))return;preview=result;if(!conflict)status=status.startsWith("已恢復")?status:"";}
    catch(error){if(revision!==previewRevision)return;preview=null;if(!conflict)status=error.message;}
    const pre=document.querySelector(".knowledge-editor .editor-preview pre");if(pre)pre.textContent=preview?.markdown||"請完成必要欄位";
    const statusNode=document.querySelector(".knowledge-editor .editor-status");if(statusNode)statusNode.textContent=status;
    const mermaidNode=document.querySelector(".knowledge-editor [data-mermaid-source]");if(mermaidNode)mermaidNode.textContent=draft.workflow?.diagrams||"";
    if(draft.knowledgeType==="workflow")renderMermaid(revision,draft.workflow?.diagrams||"");
  }
  async function renderMermaid(revision,source){
    const target=document.querySelector(".knowledge-editor [data-mermaid-preview]");if(!target)return;
    if(!source.trim()){target.textContent="輸入流程圖後顯示圖形預覽";return;}
    target.textContent="正在繪製流程圖…";
    try{
      if(!mermaidModule){mermaidModule=import("../vendor/mermaid.js").then(module=>{module.default.initialize({startOnLoad:false,securityLevel:"strict"});return module.default;});}
      const mermaid=await mermaidModule;
      const result=await mermaid.render(`phase17-mermaid-${Date.now()}-${revision}`,source);
      if(revision!==previewRevision||!draft||draft.workflow?.diagrams!==source||!target.isConnected)return;
      const frame=document.createElement("iframe");frame.title="Mermaid 流程圖預覽";frame.setAttribute("sandbox","");frame.srcdoc=result.svg;target.replaceChildren(frame);
    }catch(error){if(revision===previewRevision&&target.isConnected)target.textContent=`流程圖無法預覽：${error.message}`;}
  }
  function close(force=false){if(draft?.pendingRequestId&&!force){status=`請求 ${draft.pendingRequestId} 仍在處理，請先查詢狀態`;rerender();return false;}if(!force&&isDirty()&&!confirm("尚有未儲存修改，確定要關閉編輯器嗎？"))return false;draft=null;preview=null;status="";conflict=false;persist();rerender();return true;}

  async function submit(){
    if(!draft||busy)return;busy=true;status="正在建立安全寫入請求…";rerender();
    try{
      const errors=KnowledgeSerializer.validate(draft);if(errors.length)throw new Error(errors.join("；"));
      const result=draft.knowledgeType==="workflow"?await service.serializeWorkflow(KnowledgeSerializer.workflowPayload(draft)):KnowledgeSerializer.serialize(draft);
      if(draft.source==="local"){
        await service.saveLocal(draft);status="已儲存到本機";initial=snapshot(draft);draft=null;persist();await service.refreshLocal();rerender();return;
      }
      const outcome=await service.saveVault(draft,result,()=>persist());
      if(outcome.status==="applied"){
        status="已寫入 Vault 並完成同步回讀";initial=snapshot(draft);draft=null;persist();rerender();
      }else if(outcome.status==="conflict"){conflict=true;status=`寫入衝突：${outcome.message||"Vault 已有較新的內容"}。草稿已保留。`;}
      else if(outcome.status==="pending")status=`請求 ${outcome.requestId} 仍在處理。草稿已保留，可稍後查詢同一筆請求。`;
      else status=`寫入失敗：${outcome.message||outcome.status}。草稿已保留。`;
      persist();
    }catch(error){status=`寫入失敗：${error.message}。草稿已保留。`;}
    finally{busy=false;rerender();}
  }

  function installEvents(root){
    root.addEventListener("input",event=>{if(event.target.closest("[data-knowledge-editor-form]"))update(event.target);});
    root.addEventListener("change",event=>{if(event.target.closest("[data-knowledge-editor-form]")){update(event.target);if(["knowledgeType","source"].includes(event.target.name))rerender();}});
    root.addEventListener("submit",event=>{if(event.target.matches("[data-knowledge-editor-form]")){event.preventDefault();event.stopImmediatePropagation();submit();}},true);
    root.addEventListener("click",event=>{
      const target=event.target.closest("button,a");if(!target)return;
      if(target.dataset.editorAction==="close"){event.preventDefault();event.stopImmediatePropagation();close();return;}
      if(target.dataset.editorAction==="keep-draft"){event.preventDefault();event.stopImmediatePropagation();conflict=false;status="草稿已保留；請修改路徑或內容後再送出";rerender();return;}
      if(target.dataset.editorAction==="reload-vault"){event.preventDefault();event.stopImmediatePropagation();if(confirm("重新載入會捨棄目前草稿，確定繼續嗎？"))openVault(draft.path);return;}
      if(target.dataset.action==="new-knowledge"){event.preventDefault();event.stopImmediatePropagation();openCreate();return;}
      if(target.dataset.action==="new-local-note"){event.preventDefault();event.stopImmediatePropagation();openLocal();return;}
      if(target.dataset.editVault){event.preventDefault();event.stopImmediatePropagation();openVault(target.dataset.editVault);return;}
      if(draft&&target.dataset.route&&(draft.pendingRequestId||isDirty()&&!confirm("尚有未儲存修改，確定要離開知識編輯器嗎？"))){event.preventDefault();event.stopImmediatePropagation();}
    },true);
    window.addEventListener("beforeunload",event=>{if(isDirty()){event.preventDefault();event.returnValue="";}});
  }

  global.KnowledgeEditor=Object.freeze({configure,installEvents,render,restore,isOpen:()=>!!draft,isDirty});
})(window);
