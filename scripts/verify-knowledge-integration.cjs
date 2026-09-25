const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

for(const file of [
  'knowledge/domain/knowledge-model.js','knowledge/data/local-knowledge-adapter.js','knowledge/data/vault-knowledge-adapter.js',
  'knowledge/services/knowledge-service.js','knowledge/pages/knowledge-home.js','knowledge/styles/knowledge.css'
])assert(fs.existsSync(path.join(root,file)),`missing ${file}`);

const index=read('index.html'),workspace=read('workspace-ui.js'),app=read('app.js'),vault=read('knowledge/data/vault-knowledge-adapter.js');
assert(index.indexOf('knowledge-model.js')<index.indexOf('workspace-ui.js'),'knowledge scripts must load before workspace');
assert(workspace.includes('knowledge:KnowledgeHome.render'),'knowledge workspace must use integration renderer');
assert(app.includes('new LocalKnowledgeAdapter')&&app.includes('KnowledgeHome.configure'),'knowledge service must be configured');
assert(vault.includes('/api/notes')&&vault.includes('/api/workflows')&&vault.includes('/health'),'vault adapter must use read APIs');
assert(!vault.match(/method\s*:\s*["'](POST|PUT|PATCH|DELETE)/i),'vault adapter must remain read-only');
console.log('PASS: Phase 16 module wiring, source boundaries and read-only Vault adapter');
