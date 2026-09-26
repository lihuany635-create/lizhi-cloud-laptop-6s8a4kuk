(function(global){
  "use strict";

  const text=value=>String(value??"").trim();
  const tags=value=>Array.isArray(value)?value.map(text).filter(Boolean):[];
  const vaultKind=value=>text(value).toLowerCase()==="workflow"?"workflow":"note";

  function fromLocal(record){
    return {
      id:text(record.id),source:"local",kind:text(record.kind)||"note",title:text(record.title)||"未命名",
      body:text(record.body),tags:tags(record.tags),createdAt:record.createdAt||null,updatedAt:record.updatedAt||null,raw:record
    };
  }

  function fromVault(record,kind){
    const path=text(record.path);
    const content=text(record.content);
    const heading=(/^#\s+(.+)$/m.exec(content)||[])[1];
    return {
      id:path,source:"vault",kind:vaultKind(kind||record.type),title:text(heading||record.title)||path.replace(/^.*\//,"").replace(/\.(md|canvas)$/i,""),
      path,tags:tags(record.tags),category:text(record.category),contentHash:text(record.contentHash),body:content,
      modifiedAt:record.modifiedAt||null,raw:record
    };
  }

  function matches(item,query){
    const needle=text(query).toLocaleLowerCase();
    if(!needle)return true;
    return [item.title,item.body,item.path,item.category,...(item.tags||[])].some(value=>text(value).toLocaleLowerCase().includes(needle));
  }

  global.KnowledgeModel=Object.freeze({fromLocal,fromVault,matches});
})(window);
