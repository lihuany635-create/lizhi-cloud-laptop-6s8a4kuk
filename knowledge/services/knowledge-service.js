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
    async loadVaultItem(path){
      const detail=await this.vault.get(path);
      const current=this.snapshot.vault.find(item=>item.path===path);
      const merged={...current,...detail,kind:current?.kind||detail.kind};
      this.snapshot={...this.snapshot,vault:this.snapshot.vault.map(item=>item.path===path?merged:item)};
      return merged;
    }
    current(){return {...this.snapshot,local:this.local.listSync?this.local.listSync():this.snapshot.local,loading:this.loading};}
    filter(items,query){return items.filter(item=>KnowledgeModel.matches(item,query));}
  }

  global.KnowledgeService=KnowledgeService;
})(window);
