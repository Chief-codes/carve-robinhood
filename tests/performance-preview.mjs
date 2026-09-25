// Local-only cold-load/failure QA server; not bundled or deployed.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {gzipSync} from 'node:zlib';
const root=resolve('dist/client'),mode=process.env.CARVE_PERF_MODE||'cold',port=Number(process.env.CARVE_PERF_PORT||4190);
const heavy=/(jump-|walk-|sit-|eyes-|computer-|carve-launch-example)/;
const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2','.mp4':'video/mp4'};
let total=0,count=0;
http.createServer(async(req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/__qa_summary'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({mode,requests:count,bytes:total}));return;}
 const path=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
 if(!path.startsWith(root+sep)){res.writeHead(403);res.end();return;}
 try{
  if(mode==='blocked'&&heavy.test(pathname)){res.writeHead(503);res.end();return;}
  let data=await readFile(path);const mime=types[extname(path)]||'application/octet-stream';
  res.setHeader('Content-Type',mime);res.setHeader('Cache-Control','no-store');
  if(/javascript|text\//.test(mime)){data=gzipSync(data);res.setHeader('Content-Encoding','gzip');}
  res.setHeader('Content-Length',data.length);
  total+=data.length;count++;console.log(JSON.stringify({path:pathname,bytes:data.length,total}));
  // Later images may be deliberately slow; they must not block the first buddy.
  if(mode==='slow'&&heavy.test(pathname))await new Promise(r=>setTimeout(r,8000));
  res.end(data);
 }catch{res.writeHead(404);res.end();}
}).listen(port,'127.0.0.1',()=>console.log(`Local ${mode} QA: http://127.0.0.1:${port}`));
