(function(global){
  "use strict";

  const TYPES=Object.freeze([
    ["note","一般筆記"],["workflow","施工流程"],["regulation","法規整理"],["quality","品質檢查"],
    ["experience","經驗紀錄"],["solution","問題／解法"],["custom","自訂知識"]
  ]);
  const TYPE_LABEL=Object.fromEntries(TYPES);
  const detailSections={
    regulation:[["source","法規來源"],["clauses","條文內容"],["scenario","適用情境"],["cautions","注意事項"],["relatedWorkflow","相關工法"]],
    quality:[["checkItems","檢查項目"],["defects","常見缺失"],["improvements","改善方式"],["relatedWorkflow","相關工法"]],
    experience:[["date","日期"],["context","情境"],["event","事件"],["handling","處理方式"],["result","結果"],["reflection","反思"]],
    solution:[["problem","問題"],["cause","原因"],["attempts","嘗試方法"],["solution","最後解法"],["cautions","注意事項"]]
  };
  const clean=value=>String(value??"").replace(/\r\n?/g,"\n").trim();
  const tags=value=>(Array.isArray(value)?value:String(value||"").split(",")).map(clean).filter(Boolean);
  const yaml=value=>JSON.stringify(clean(value));
  const safePath=title=>clean(title).replace(/[<>:"/\\|?*]+/g,"-").replace(/[. ]+$/g,"")||"knowledge";

  function createDraft(options={}){
    return {source:"vault",mode:"create",knowledgeType:"note",title:"",category:"",tags:[],summary:"",content:"",relations:[],path:"",contentHash:"",details:{},workflow:{diagrams:"",steps:"",quality:"",notes:"",status:"",relatedRegulations:"",relatedNotes:"",photos:""},...options};
  }

  function validate(draft){
    const errors=[];
    if(!clean(draft.title))errors.push("請填寫標題");
    if(!TYPE_LABEL[draft.knowledgeType])errors.push("請選擇知識類型");
    if(draft.source==="vault"&&!pathFor(draft))errors.push("請填寫安全的 Vault Markdown 路徑");
    if(draft.knowledgeType==="workflow"&&!clean(draft.workflow?.diagrams))errors.push("施工流程需要 Mermaid 圖");
    if(["note","custom"].includes(draft.knowledgeType)&&!clean(draft.content))errors.push("請填寫內容");
    return errors;
  }

  function pathFor(draft){
    const requested=clean(draft.path).replace(/\\/g,"/");
    const result=requested||`${safePath(draft.title)}.md`;
    if(result.startsWith("/")||result.split("/").some(segment=>!segment||segment==="."||segment===".."||/[<>:"|?*]/.test(segment))||!result.toLowerCase().endsWith(".md"))return "";
    return result;
  }

  function frontmatter(draft){
    const lines=["---",`type: ${yaml(draft.knowledgeType)}`];
    if(clean(draft.category))lines.push(`category: ${yaml(draft.category)}`);
    if(tags(draft.tags).length)lines.push(`tags: ${JSON.stringify(tags(draft.tags))}`);
    if(clean(draft.summary))lines.push(`summary: ${yaml(draft.summary)}`);
    for(const line of draft.extraFrontmatter||[])if(!/^(type|category|tags|summary)\s*:/i.test(line))lines.push(line);
    lines.push("---","");
    return lines;
  }

  function serialize(draft){
    const errors=validate(draft);if(errors.length)throw new Error(errors.join("；"));
    const parts=[...frontmatter(draft),`# ${clean(draft.title)}`];
    if(clean(draft.summary))parts.push("","## 摘要","",clean(draft.summary));
    if(detailSections[draft.knowledgeType]){
      for(const [key,label] of detailSections[draft.knowledgeType]){
        const value=clean(draft.details?.[key]);if(value)parts.push("",`## ${label}`,"",value);
      }
    }
    if(clean(draft.content))parts.push("",clean(draft.content));
    return {markdown:parts.join("\n").replace(/\n{3,}/g,"\n\n").trim()+"\n",suggestedPath:pathFor(draft),warnings:[]};
  }

  function workflowPayload(draft){
    const lines=clean(draft.workflow?.steps).split("\n").map(clean).filter(Boolean);
    return {
      title:clean(draft.title),category:clean(draft.category),tags:tags(draft.tags),status:clean(draft.workflow?.status),description:clean(draft.summary||draft.content),path:pathFor(draft),
      diagrams:[clean(draft.workflow?.diagrams)].filter(Boolean),
      steps:lines.map(line=>{const [title,description="",checks=""]=line.split("｜");return {title:clean(title),description:clean(description),checkItems:checks.split(";").map(clean).filter(Boolean)};}),
      qualityChecklist:clean(draft.workflow?.quality).split("\n").map(clean).filter(Boolean).map(text=>({text,checked:false})),
      notes:clean(draft.workflow?.notes).split("\n").map(clean).filter(Boolean),
      relatedRegulations:clean(draft.workflow?.relatedRegulations).split("\n").map(clean).filter(Boolean),
      relatedNotes:clean(draft.workflow?.relatedNotes).split("\n").map(clean).filter(Boolean),
      photos:clean(draft.workflow?.photos).split("\n").map(clean).filter(Boolean)
    };
  }

  function parseFrontmatter(markdown){
    const match=/^---\s*\n([\s\S]*?)\n---\s*\n?/.exec(markdown);const metadata={};
    const extraFrontmatter=[];
    if(match){
      let key="",raw="",original=[];
      function flush(){if(!key)return;try{metadata[key]=JSON.parse(raw);}catch{metadata[key]=raw.replace(/^['"]|['"]$/g,"");}if(key==="tags"&&Array.isArray(metadata[key])===false)metadata[key]=original.length>1?original.slice(1).map(line=>line.replace(/^\s*-\s*/,"").trim()).filter(Boolean):tags(metadata[key]);if(!["type","category","tags","summary"].includes(key))extraFrontmatter.push(...original);}
      for(const line of match[1].split("\n")){
        const top=/^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
        if(top){flush();key=top[1];raw=top[2];original=[line];}
        else if(key)original.push(line);
      }
      flush();
    }
    return {metadata,extraFrontmatter,body:match?markdown.slice(match[0].length):markdown};
  }

  function fromVault(item){
    const parsed=parseFrontmatter(item.body||item.raw?.content||""),body=parsed.body;
    const title=(/^#\s+(.+)$/m.exec(body)||[])[1]||item.title;
    const type=TYPE_LABEL[parsed.metadata.type]?parsed.metadata.type:(item.kind==="workflow"?"workflow":"note");
    let content=body.replace(/^#\s+.+\n?/m,"").trim(),details={};
    const summaryMatch=/(?:^|\n)## 摘要\s*\n([\s\S]*?)(?=\n## |$)/.exec(content);
    if(summaryMatch)content=content.replace(summaryMatch[0],"").trim();
    if(detailSections[type])for(const [key,label] of detailSections[type]){const match=new RegExp(`(?:^|\\n)## ${label}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`).exec(content);details[key]=clean(match?.[1]);if(match)content=content.replace(match[0],"").trim();}
    return createDraft({mode:"update",source:"vault",knowledgeType:type,title:clean(title),category:clean(parsed.metadata.category||item.category),tags:tags(parsed.metadata.tags||item.tags),summary:clean(parsed.metadata.summary||summaryMatch?.[1]),content,path:item.path,contentHash:item.contentHash,details,extraFrontmatter:parsed.extraFrontmatter});
  }

  global.KnowledgeSerializer=Object.freeze({TYPES,TYPE_LABEL,detailSections,createDraft,validate,pathFor,serialize,workflowPayload,fromVault});
})(window);
