import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4180);
const mime = {".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".json":"application/json; charset=utf-8",".webmanifest":"application/manifest+json",".svg":"image/svg+xml",".png":"image/png",".ico":"image/x-icon"};

const server = http.createServer(async (req,res)=>{
  try {
    const pathname = decodeURIComponent(new URL(req.url,"http://localhost").pathname);
    let target = path.join(root, pathname === "/" ? "index.html" : pathname);
    if (!target.startsWith(root)) throw new Error("Invalid path");
    try { if ((await stat(target)).isDirectory()) target = path.join(target,"index.html"); }
    catch { target = path.join(root,"index.html"); }
    const data = await readFile(target);
    res.writeHead(200,{"content-type":mime[path.extname(target)]||"application/octet-stream","cache-control":"no-store"});
    res.end(data);
  } catch (error) {
    res.writeHead(500,{"content-type":"text/plain; charset=utf-8"});
    res.end(error instanceof Error ? error.message : "Server error");
  }
});
server.listen(port,"127.0.0.1",()=>console.log(`立之雲端庫本機版：http://127.0.0.1:${port}`));
