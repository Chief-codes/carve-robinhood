import { defineConfig } from 'vite';
import {readFileSync} from 'node:fs';
const csp=readFileSync(new URL('./public/_headers',import.meta.url),'utf8').split('\n').find(line=>line.trim().startsWith('Content-Security-Policy:'))!.trim().slice('Content-Security-Policy:'.length).trim();
export default defineConfig({
 build:{outDir:'dist/client',target:'es2022'},
 server:{host:'127.0.0.1',port:5188,strictPort:true,headers:{'Content-Security-Policy':csp.replace("connect-src 'self'", "connect-src 'self' ws://127.0.0.1:5188")}},
 preview:{headers:{'Content-Security-Policy':csp,'X-Content-Type-Options':'nosniff'}}
});
