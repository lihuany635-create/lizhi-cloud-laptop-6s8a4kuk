(function(global){
  "use strict";

  class KnowledgeService{
    constructor({local,vault}){
      this.local=local;this.vault=vault;this.loading=false;
      this.snapshot={local:[],vault:[],vaultStatus:vault?.enabled===false?"disabled":"idle",vaultError:"",health:null,loadedAt:null};
    }

    async load({force=false}={}){
      if(this.loading)return this.snapshot;
      if(this.snapshot.loadedAt&&!force)return this.snapshot;
      this.loading=true;
      this.snapshot={...this.snapshot,local:await this.local.list(),vaultStatus:this.vault?.enabled===false?"disabled":"connecting",vaultError:""};
      if(this.vault?.enabled!==false){
        try{
          const result=await this.vault.list();
          this.snapshot={...this.snapshot,vault:result.items,vaultStatus:result.status,health:result.health,vaultError:""};
        }catch(error){
          this.snapshot={...this.snapshot,vault:[],vaultStatus:"offline",health:null,vaultError:error?.name==="AbortError"?"連線逾時":String(error?.message||"無法連線")};
        }
      }
      this.snapshot={...this.snapshot,loadedAt:new Date().toISOString()};
      this.loading=false;
      return this.snapshot;
    }

    async refresh(){return this.load({force:true});}
    async refreshLocal(){this.snapshot={...this.snapshot,local:await this.local.list()};return this.current();}
    async loadVaultItem(path){
      const detail=await this.vault.get(path);
      const current=this.snapshot.vault.find(item=>item.path===path);
      const merged={...current,...detail,kind:current?.kind||detail.kind};
      this.snapshot={...this.snapshot,vault:this.snapshot.vault.map(item=>item.path===path?merged:item)};
      return merged;
    }
    async loadWorkflow(path){return this.vault.getWorkflow(path);}
    async serializeWorkflow(payload){return this.vault.serializeWorkflow(payload);}
    async saveLocal(draft){return this.local.save(draft);}
    async saveVault(draft,serialized,onAccepted=()=>{}){
      if(this.snapshot.vaultStatus!=="online")throw new Error("Vault 未連線，未送出寫入請求");
      const operation=draft.mode==="update"?"update":"create";
      let requestId=draft.pendingRequestId;
      if(!requestId){
        const response=await this.vault.createWriteRequest({operation,path:serialized.suggestedPath,content:serialized.markdown,baseHash:operation==="update"?draft.contentHash:null,source:"lizhi-cloud-phase17"});
        requestId=response.request?.requestId;if(!requestId)throw new Error("伺服器未回傳 requestId");
        draft.pendingRequestId=requestId;onAccepted(requestId);
      }
      const completed=await this.waitForRequest(requestId);
      if(completed.status!=="applied"){
        if(["conflict","failed"].includes(completed.status))delete draft.pendingRequestId;
        return completed;
      }
      await this.waitForRoundTrip(serialized.suggestedPath,draft.contentHash,serialized.markdown);
      await this.refresh();
      delete draft.pendingRequestId;
      return completed;
    }
    async waitForRequest(requestId,{timeoutMs=45000}={}){
      const deadline=Date.now()+timeoutMs;
      while(Date.now()<deadline){
        const request=await this.vault.getWriteRequest(requestId);
        if(["applied","conflict","failed"].includes(request.status))return request;
        await new Promise(resolve=>setTimeout(resolve,600));
      }
      return {status:"pending",message:"Sync Agent 尚未完成；請稍後查詢同一筆請求",requestId};
    }
    async waitForRoundTrip(path,oldHash,expectedMarkdown,{timeoutMs=20000}={}){
      const deadline=Date.now()+timeoutMs;
      while(Date.now()<deadline){
        try{const item=await this.vault.get(path);if(item.contentHash&&item.contentHash!==oldHash&&item.body.trim()===expectedMarkdown.trim())return item;}catch{}
        await new Promise(resolve=>setTimeout(resolve,600));
      }
      throw new Error("寫入已套用，但等待 Mirror／Index 回讀逾時");
    }
    current(){return {...this.snapshot,local:this.local.listSync?this.local.listSync():this.snapshot.local,loading:this.loading};}
    filter(items,query){return items.filter(item=>KnowledgeModel.matches(item,query));}
  }

  global.KnowledgeService=KnowledgeService;
})(window);
