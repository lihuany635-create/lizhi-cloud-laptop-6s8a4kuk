(function(global){
  "use strict";

  class LocalKnowledgeAdapter{
    constructor(options={}){this.records=options.records||(()=>[]);}
    listSync(){
      return this.records().filter(row=>["folder","note","document"].includes(row.kind)&&!row.deletedAt).map(KnowledgeModel.fromLocal);
    }
    async list(){
      return this.listSync();
    }
  }

  global.LocalKnowledgeAdapter=LocalKnowledgeAdapter;
})(window);
