const CACHE="lizhi-cloud-v8";
const FILES=["","index.html","styles.css?v=8","theme.css?v=8","study.css?v=8","chat.css?v=8","app.js?v=8","manifest.webmanifest","media-manifest.json","a4-editor/","a4-editor/index.html","a4-editor/styles.css","a4-editor/app.js","a4-editor/docx-builder.js"].map(file=>new URL(file,self.registration.scope).href);
self.addEventListener("install",event=>{
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)));
});
self.addEventListener("activate",event=>event.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))),self.clients.claim()])));
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  event.respondWith(fetch(event.request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response;}).catch(()=>caches.match(event.request)));
});
