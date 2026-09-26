(function(global){
  "use strict";

  class VaultKnowledgeAdapter{
    constructor(options={}){
      this.baseUrl=(options.baseUrl||"http://127.0.0.1:8000").replace(/\/$/,"");
      this.enabled=options.enabled!==false;
      this.timeoutMs=options.timeoutMs||3500;
      this.retries=Number.isInteger(options.retries)?options.retries:1;
    }

    async request(path){
      let lastError;
      for(let attempt=0;attempt<=this.retries;attempt++){
        const controller=new AbortController();
        const timer=setTimeout(()=>controller.abort(),this.timeoutMs);
        try{
          const response=await fetch(this.baseUrl+path,{cache:"no-store",signal:controller.signal,headers:{Accept:"application/json"}});
          if(!response.ok)throw new Error(`Vault API ${response.status}`);
          return await response.json();
        }catch(error){
          lastError=error;
          if(attempt<this.retries)await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)));
        }finally{clearTimeout(timer);}
      }
      throw lastError;
    }

    async list(){
      if(!this.enabled)return {status:"disabled",items:[],health:null};
      const [health,notesPayload,workflowsPayload]=await Promise.all([
        this.request("/health"),this.request("/api/notes"),this.request("/api/workflows")
      ]);
      const workflows=new Map((workflowsPayload.workflows||[]).map(item=>[item.path,item]));
      const notes=notesPayload.notes||[],details=new Array(notes.length);let cursor=0;
      async function loadDetail(adapter){while(cursor<notes.length){const index=cursor++;try{details[index]=await adapter.request(`/api/note?path=${encodeURIComponent(notes[index].path)}`);}catch{details[index]=notes[index];}}}
      await Promise.all(Array.from({length:Math.min(6,notes.length)},()=>loadDetail(this)));
      return {
        status:"online",health,
        items:details.map(note=>KnowledgeModel.fromVault({...note,...(workflows.get(note.path)||{})},workflows.has(note.path)?"workflow":"note"))
      };
    }

    async get(path){return KnowledgeModel.fromVault(await this.request(`/api/note?path=${encodeURIComponent(path)}`));}

    async getWorkflow(path){return this.request(`/api/workflow?path=${encodeURIComponent(path)}`);}

    async serializeWorkflow(payload){
      return this.requestJson("/api/workflow/serialize",payload);
    }

    async createWriteRequest(payload){
      if(!this.enabled)throw new Error("目前環境未啟用 Vault 寫入");
      return this.requestJson("/api/write-requests",payload);
    }

    async getWriteRequest(requestId){return this.request(`/api/write-requests/${encodeURIComponent(requestId)}`);}

    async requestJson(path,payload){
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.timeoutMs);
      try{
        const response=await fetch(this.baseUrl+path,{method:"POST",signal:controller.signal,headers:{Accept:"application/json","Content-Type":"application/json"},body:JSON.stringify(payload)});
        const body=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(body.detail||`Vault API ${response.status}`);
        return body;
      }finally{clearTimeout(timer);}
    }

    async search(query,filters={}){
      if(!this.enabled)return [];
      const params=new URLSearchParams({q:query||"",limit:String(filters.limit||50)});
      if(filters.type)params.set("type",filters.type);
      if(filters.category)params.set("category",filters.category);
      for(const tag of filters.tags||[])params.append("tag",tag);
      const payload=await this.request(`/api/search?${params}`);
      return (payload.results||[]).map(item=>KnowledgeModel.fromVault(item,item.type));
    }

  }

  global.VaultKnowledgeAdapter=VaultKnowledgeAdapter;
})(window);
