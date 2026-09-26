(function(global){
  "use strict";

  class LocalKnowledgeAdapter{
    constructor(options={}){this.records=options.records||(()=>[]);this.put=options.put||null;this.afterSave=options.afterSave||null;}
    listSync(){
      return this.records().filter(row=>["folder","note","document"].includes(row.kind)&&!row.deletedAt).map(KnowledgeModel.fromLocal);
    }
    async list(){
      return this.listSync();
    }
    async save(draft){
      if(!this.put)throw new Error("本機儲存功能尚未連接");
      const existing=draft.id?this.records().find(row=>row.id===draft.id):null;
      const stamp=new Date().toISOString();
      const saved=await this.put({...(existing||{}),id:draft.id||crypto.randomUUID(),kind:"note",title:draft.title.trim(),body:draft.content.trim(),tags:draft.tags||[],createdAt:existing?.createdAt||stamp,updatedAt:stamp});
      if(this.afterSave)await this.afterSave();
      return saved;
    }
  }

  global.LocalKnowledgeAdapter=LocalKnowledgeAdapter;
})(window);
