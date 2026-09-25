import { defineConfig } from 'vite';
import {readFileSync} from 'node:fs';
import {handleMusebook} from './netlify/functions/musebook';
const csp=readFileSync(new URL('./public/_headers',import.meta.url),'utf8').split('\n').find(line=>line.trim().startsWith('Content-Security-Policy:'))!.trim().slice('Content-Security-Policy:'.length).trim();
export default defineConfig({
 plugins:[{name:'carve-public-musebook-read',configureServer(server){server.middlewares.use('/api/musebook',async(req,res)=>{try{const result=await handleMusebook(new Request('http://localhost/api/musebook'+(req.url||''),{method:req.method}));res.statusCode=result.status;result.headers.forEach((value,key)=>res.setHeader(key,value));res.end(await result.text());}catch{res.statusCode=502;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'Public feed unavailable. Try again later.'}));}});}}],
 build:{outDir:'dist/client',target:'es2022'},
 server:{host:'127.0.0.1',port:5188,strictPort:true,headers:{'Content-Security-Policy':csp.replace("connect-src 'self'", "connect-src 'self' ws://127.0.0.1:5188")}},
 preview:{headers:{'Content-Security-Policy':csp,'X-Content-Type-Options':'nosniff'}}
});
