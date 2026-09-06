// Run after every scheduled upload, including no-change runs. Public report contains no local paths.
import {readFileSync,writeFileSync,readdirSync,statSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../',import.meta.url));
const reportPath = path.join(root,'upload-status.json');
const previous = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath,'utf8')) : {};
const report = {version:1,checkedAt:new Date().toISOString(),schedule:'21:20',timeZone:'Asia/Taipei',lastSuccessAt:previous.lastSuccessAt||null,pendingCount:null,status:'error',error:null};
try {
  const manifest = JSON.parse(readFileSync(path.join(root,'media-manifest.json'),'utf8'));
  const release = JSON.parse(execFileSync('gh',['api','repos/lihuany635-create/lizhi-cloud-laptop-6s8a4kuk/releases/tags/media-2026-08-23'],{encoding:'utf8'}));
  const missing = manifest.filter(item => !release.assets.some(asset => asset.name === item.assetName && asset.size === item.size && asset.state === 'uploaded'));
  if(missing.length) throw new Error(`${missing.length} 個目錄項目缺少完整雲端檔案`);
  const normalize = name => name.replace(/\.[^.]+$/,'').replace(/-雲端版$/,'');
  const knownNames = new Set(manifest.map(item=>normalize(item.fileName)));
  const knownHashes = new Set(release.assets.map(a=>a.digest).filter(Boolean));
  const imports = path.join(root,'imports');
  const pending = readdirSync(imports,{withFileTypes:true}).filter(entry=>entry.isFile() && /\.(mp3|m4a|wav|aac|ogg|mp4|webm|mov)$/i.test(entry.name)).filter(entry=>{
    if(knownNames.has(normalize(entry.name))) return false;
    const digest = 'sha256:'+createHash('sha256').update(readFileSync(path.join(imports,entry.name))).digest('hex');
    return !knownHashes.has(digest);
  });
  report.pendingCount = pending.length;
  report.cloudCount = manifest.length;
  report.lastSuccessAt = release.assets.map(a=>a.updated_at).sort().at(-1)||previous.lastSuccessAt||null;
  report.status = pending.length ? 'pending' : 'success';
  report.message = pending.length ? `目錄與雲端檔案相符；本機另有 ${pending.length} 個影音待確認／上傳` : `已驗證 ${manifest.length} 個雲端檔案，未發現待上傳影音`;
  if(process.argv.includes('--error')) throw new Error(process.argv[process.argv.indexOf('--error')+1]||'上傳工作失敗');
} catch(error) {
  report.status = 'error';
  report.error = '雲端檔案驗證或上傳工作失敗，請查看這台電腦的排程執行紀錄';
  report.message = '本次檢查未完成，不代表影音已同步';
  console.error(error.message);
  process.exitCode = 1;
}
writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
