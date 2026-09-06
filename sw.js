const CACHE="lizhi-cloud-v17";
const FILES=["","index.html","styles.css?v=15","theme.css?v=15","study.css?v=15","chat.css?v=15","workspace-ui.css?v=17","chat-delivery.js?v=17","workspace-ui.js?v=17","app.js?v=17","manifest.webmanifest","media-manifest.json","a4-editor/?v=14","a4-editor/index.html","a4-editor/styles.css?v=14","a4-editor/app.js?v=14","a4-editor/docx-builder.js?v=14"].map(file=>new URL(file,self.registration.scope).href);
self.addEventListener("install",event=>{
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)));
});
self.addEventListener("activate",event=>event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))),self.clients.claim()])));
self.addEventListener("fetch",event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=="GET"||url.origin!==self.location.origin||url.pathname.endsWith('/upload-status.json'))return;
  if(event.request.headers.has('range'))return;
  event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{}));}return response;}).catch(async()=>await caches.match(event.request)||new Response('離線且尚未快取此內容',{status:503})));
});
