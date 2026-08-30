const CACHE="lizhi-cloud-v13";
const FILES=["","index.html","styles.css?v=13","theme.css?v=13","study.css?v=13","chat.css?v=13","app.js?v=13","manifest.webmanifest","media-manifest.json","a4-editor/?v=13","a4-editor/index.html","a4-editor/styles.css?v=13","a4-editor/app.js?v=13","a4-editor/docx-builder.js?v=13"].map(file=>new URL(file,self.registration.scope).href);
self.addEventListener("install",event=>{
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)));
});
self.addEventListener("activate",event=>event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))),self.clients.claim()])));
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  event.respondWith(fetch(event.request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response;}).catch(()=>caches.match(event.request)));
});
