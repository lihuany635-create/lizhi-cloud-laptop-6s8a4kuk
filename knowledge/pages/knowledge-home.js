(function(global){
  "use strict";

  let service=null,rerender=()=>{},loadStarted=false,expandedPath="";
  const esc=value=>String(value??"").replace(/[&<>'"]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char]);
  const chip=(label,kind="")=>`<span class="chip source-chip ${kind}">${esc(label)}</span>`;
  const empty=message=>`<div class="empty">${esc(message)}</div>`;

  function configure(options){service=options.service;rerender=options.rerender||rerender;}
  function ensureLoaded(){
    if(!service||loadStarted||service.current().loadedAt)return;
    loadStarted=true;
    service.load().finally(()=>{loadStarted=false;rerender();});
  }

  function localCard(item){
    if(item.kind==="folder")return `<article class="card knowledge-card"><div class="card-top"><span>📁</span>${chip("本機","local")}</div><h3>${esc(item.title)}</h3><p>保存在此瀏覽器</p></article>`;
    if(item.kind==="document")return `<article class="card knowledge-card"><div class="card-top"><span>▤</span>${chip("本機","local")}</div><h3>${esc(item.title)}</h3><p>${esc(item.raw.type||"檔案")}</p><div class="card-actions"><button class="button" data-download="${esc(item.id)}">下載／查看</button></div></article>`;
    return `<article class="card knowledge-card"><div class="card-top"><span>✎</span>${chip("本機","local")}</div><h3>${esc(item.title)}</h3><p class="note-body">${esc(item.body)}</p><div class="meta">${item.tags.map(tag=>chip(`# ${tag}`)).join("")}</div><div class="card-actions"><button class="button" data-edit-note="${esc(item.id)}">編輯</button></div></article>`;
  }

  function vaultCard(item){
    const open=expandedPath===item.path;
    return `<article class="card knowledge-card vault-card"><div class="card-top"><span>${item.kind==="workflow"?"◇":"◆"}</span>${chip("Obsidian Vault","vault")}</div><h3>${esc(item.title)}</h3><p class="vault-path">${esc(item.path)}</p>${item.category?`<p>${chip(item.category,"category")}</p>`:""}<div class="meta">${item.tags.map(tag=>chip(`# ${tag}`)).join("")}</div>${open?`<div class="vault-preview"><pre>${esc(item.body||"正在讀取本文…")}</pre></div>`:""}<div class="card-actions"><button class="button" data-vault-path="${esc(item.path)}">${open?"收合內容":"預覽內容"}</button><button class="button" data-edit-vault="${esc(item.path)}">編輯 Vault 知識</button></div></article>`;
  }

  function status(snapshot){
    if(snapshot.vaultStatus==="online")return `<span class="knowledge-status online">● Vault 已連線 · ${snapshot.vault.length} 項</span>`;
    if(snapshot.vaultStatus==="connecting"||snapshot.loading)return `<span class="knowledge-status connecting">● 正在連接 Vault…</span>`;
    if(snapshot.vaultStatus==="disabled")return `<span class="knowledge-status disabled">Vault 僅限本機使用；目前網站環境未啟用</span>`;
    if(snapshot.vaultStatus==="offline")return `<span class="knowledge-status offline">Vault 未連線；本機知識仍可正常使用</span>`;
    return `<span class="knowledge-status connecting">準備連接 Vault…</span>`;
  }

  function render(){
    if(!service)return typeof renderKnowledge==="function"?renderKnowledge():empty("知識服務尚未準備完成");
    ensureLoaded();
    const snapshot=service.current(),query=global.state?.query??state?.query??"";
    const local=service.filter(snapshot.local,query),vault=service.filter(snapshot.vault,query);
    const folders=local.filter(item=>item.kind==="folder"),notes=local.filter(item=>item.kind==="note"),documents=local.filter(item=>item.kind==="document");
    const vaultNotes=vault.filter(item=>item.kind==="note"),workflows=vault.filter(item=>item.kind==="workflow");
    const actions=`<button class="button" data-action="refresh-vault">重新連線</button><button class="button" data-action="upload-knowledge">↑ 上傳文件</button><button class="button" data-action="new-folder">＋ 資料夾</button><button class="button" data-action="new-local-note">＋ 本機筆記</button><button class="button primary" data-action="new-knowledge">＋ 新增知識</button>`;
    return `${head("KNOWLEDGE WORKSPACE","知識工作區","同一個入口整合本機收藏與 Obsidian Vault；Vault 寫入須經安全請求與同步代理。",actions)}
      <div class="knowledge-connection">${status(snapshot)}${snapshot.vaultError?`<small>${esc(snapshot.vaultError)}</small>`:""}</div>
      <div class="stats"><div class="stat"><b>${folders.length}</b><small>本機資料夾</small></div><div class="stat"><b>${notes.length+documents.length}</b><small>本機內容</small></div><div class="stat"><b>${vaultNotes.length}</b><small>Vault Markdown</small></div><div class="stat"><b>${workflows.length}</b><small>Vault Workflow</small></div></div>
      <div class="toolbar"><input class="field search" data-search placeholder="搜尋本機與 Vault 知識" value="${esc(query)}"><button class="button" data-action="clear-search">清除</button></div>
      <section class="section"><div class="section-head"><h2>本機收藏</h2><span class="count">${local.length} 項</span></div><div class="grid">${local.length?local.map(localCard).join(""):empty("沒有符合條件的本機內容")}</div></section>
      <section class="section vault-section"><div class="section-head"><h2>Obsidian Markdown</h2><span class="count">${vaultNotes.length} 份</span></div><div class="grid">${vaultNotes.length?vaultNotes.map(vaultCard).join(""):empty(snapshot.vaultStatus==="online"?"沒有符合條件的 Markdown":"連線後會在這裡顯示 Vault 筆記")}</div></section>
      <section class="section vault-section"><div class="section-head"><h2>Obsidian Workflow</h2><span class="count">${workflows.length} 份</span></div><div class="grid">${workflows.length?workflows.map(vaultCard).join(""):empty(snapshot.vaultStatus==="online"?"沒有符合條件的 Workflow":"連線後會在這裡顯示 Mermaid 工作流程")}</div></section>${KnowledgeEditor.render()}`;
  }

  function installEvents(root){
    root.addEventListener("click",event=>{
      const button=event.target.closest("button");if(!button)return;
      if(button.dataset.action==="refresh-vault"){
        event.stopImmediatePropagation();
        service?.refresh().finally(rerender);rerender();
      }
      if(button.dataset.vaultPath){
        event.stopImmediatePropagation();
        const path=button.dataset.vaultPath;
        if(expandedPath===path){expandedPath="";rerender();return;}
        expandedPath=path;rerender();
        const item=service?.current().vault.find(entry=>entry.path===path);
        if(item&&!item.body)service.loadVaultItem(path).then(rerender).catch(()=>{});
      }
    },true);
  }

  global.KnowledgeHome=Object.freeze({configure,installEvents,render});
})(window);
