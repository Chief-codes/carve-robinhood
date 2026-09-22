import { bytesToHex, keccak256 } from 'viem';
import {compressGif} from './gif';
export const CHUNK_BYTES = 20 * 1024;
export const MAX_FILE_BYTES = 1024 * 1024;
export type AssetKind = 'image' | 'audio' | 'website';
export type ContentAsset = { kind: AssetKind; name: string; mime: string; bytes: Uint8Array; originalBytes: number; sha256: string; keccak: `0x${string}`; };
export type Draft = { version: 1; name: string; symbol: string; description: string; website: string; twitter: string; initialBuy: string; creatorFee?: string; assets: Partial<Record<AssetKind, ContentAsset>>; updatedAt: number; };
export const newDraft = (): Draft => ({version:1,name:'',symbol:'',description:'',website:'',twitter:'',initialBuy:'',assets:{},updatedAt:Date.now()});
const accepted: Record<AssetKind,string[]> = {image:['image/png','image/jpeg','image/webp','image/gif'],audio:['audio/mpeg','audio/mp4','audio/wav','audio/x-wav','audio/ogg','audio/webm'],website:['text/html']};
export function normalizeMime(kind:AssetKind, mime:string, name:string) {
  const base=mime.split(';')[0].trim().toLowerCase();
  if (kind==='website' && /\.html?$/i.test(name)) return 'text/html';
  return base;
}
export async function makeAsset(kind:AssetKind,name:string,mime:string,bytes:Uint8Array,originalBytes=bytes.length):Promise<ContentAsset> {
  mime=normalizeMime(kind,mime,name);
  if (!accepted[kind].includes(mime)) throw new Error(`Unsupported ${kind} file. ${kind==='image'?'Use PNG, JPEG, WebP or GIF.':kind==='audio'?'Use MP3, M4A, WAV, OGG or WebM.':'Use a self-contained HTML file.'}`);
  if (!bytes.length) throw new Error('This file is empty.');
  if (bytes.length>MAX_FILE_BYTES) throw new Error('Keep each prepared asset under 1 MB. Onchain storage costs grow with file size.');
  const digest = await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes));
  return {kind,name,mime,bytes:Uint8Array.from(bytes),originalBytes,sha256:bytesToHex(new Uint8Array(digest)),keccak:keccak256(bytes)};
}
export function splitChunks(bytes:Uint8Array) { return Array.from({length:Math.ceil(bytes.length/CHUNK_BYTES)},(_,i)=>bytes.slice(i*CHUNK_BYTES,(i+1)*CHUNK_BYTES)); }
export function bytesLabel(n:number) { return n<1024?`${n} B`:n<1024*1024?`${(n/1024).toFixed(1)} KB`:`${(n/1024/1024).toFixed(2)} MB`; }
export function planAssets(assets:Draft['assets']) {
  const files=Object.values(assets).filter((x):x is ContentAsset=>!!x); const bytes=files.reduce((n,a)=>n+a.bytes.length,0);
  const chunks=files.reduce((n,a)=>n+splitChunks(a.bytes).length,0);
  return {bytes,chunks,files:files.length,uploadTransactions:chunks+files.length,codeDepositGas:BigInt(bytes+chunks)*200n};
}
export async function optimizeImage(file:File,dimension:number,quality=0.8) {
  if(file.size>12*1024*1024) throw new Error('Choose an image smaller than 12 MB before optimization.');
  if(file.type==='image/gif'||/\.gif$/i.test(file.name)) return makeAsset('image',file.name,'image/gif',await compressGif(new Uint8Array(await file.arrayBuffer()),dimension),file.size);
  const bitmap=await createImageBitmap(file);
  try {
    const ratio=Math.min(1,dimension/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Image preparation is unavailable in this browser.');
    ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Could not prepare image.')),'image/webp',quality));
    return makeAsset('image',file.name.replace(/\.[^.]+$/,'')+'.webp',blob.type,new Uint8Array(await blob.arrayBuffer()),file.size);
  } finally {bitmap.close();}
}
export const PREVIEW_CSP="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export function isolatedHtml(html:string) {
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width, initial-scale=1">${html}`;
}
export function externalReferences(html:string):string[] {
  // Preflight guidance, not an HTML security boundary. The opaque iframe and CSP
  // also constrain scripts and navigation that static resource discovery misses.
  const refs:string[]=[];
  const add=(value:string)=>{const v=value.trim();if(v&&!/^(?:data:|#|mailto:|tel:)/i.test(v))refs.push(v);};
  for(const m of html.matchAll(/\b(?:src|href|poster|action|formaction|background|data)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi))add(m[1]??m[2]??m[3]);
  for(const m of html.matchAll(/\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)){
    for(const candidate of (m[1]??m[2]??m[3]).matchAll(/(?:^|[\s,]+)(data:[^\s]+|[^\s,]+)(?:\s+(?:[\d.]+[wx]))?/gi))add(candidate[1]);
  }
  for(const m of html.matchAll(/url\(\s*["']?([^\s)'";]+)|@import\s+["']([^"']+)["']/gi))add(m[1]??m[2]);
  for(const tag of html.matchAll(/<meta\b[^>]*>/gi))if(/http-equiv\s*=\s*["']?refresh\b/i.test(tag[0])){
    const target=tag[0].match(/\burl\s*=\s*["']?([^\s"'>;]+)/i);if(target)add(target[1]);
  }
  return [...new Set(refs)].slice(0,10);
}
export function validateDraft(d:Draft) {
  const issues:string[]=[];
  if(!d.name.trim()) issues.push('Give your token a name.');
  if(new TextEncoder().encode(d.name.trim()).length>64) issues.push('Token name must fit in 64 UTF-8 bytes.');
  if(!/^[A-Za-z0-9]{1,12}$/.test(d.symbol.trim())) issues.push('Ticker must be 1–12 letters or numbers.');
  if(!Object.values(d.assets).some(Boolean)) issues.push('Add at least one image, sound or website. You can combine all three.');
  if(d.initialBuy&&!/^\d+(\.\d{1,18})?$/.test(d.initialBuy)) issues.push('Initial buy must be a valid ETH amount.');
  if(!/^(?:[0-9](?:\.\d{1,2})?|10(?:\.0{1,2})?)$/.test(d.creatorFee||'0')) issues.push('Creator fee must be between 0% and 10%, with at most two decimal places.');
  return issues;
}
export function exportDraft(d:Draft) {return JSON.stringify({...d,assets:Object.fromEntries(Object.entries(d.assets).map(([k,a])=>[k,{...a,bytes:bytesToHex(a!.bytes)}]))},null,2);}
export async function importDraft(text:string):Promise<Draft> {
  if(text.length>MAX_FILE_BYTES*8)throw new Error('Draft file is too large.');
  const value=JSON.parse(text);if(value.version!==1||typeof value.name!=='string'||typeof value.symbol!=='string')throw new Error('Not a Carve draft file.');
  const d=newDraft();
  for(const k of ['name','symbol','description','website','twitter','initialBuy','creatorFee'] as const) if(typeof value[k]==='string')d[k]=value[k].slice(0,10000);
  for(const k of ['image','audio','website'] as AssetKind[]) {
    const a=value.assets?.[k];if(!a)continue;
    if(typeof a.bytes!=='string'||!/^0x([a-f0-9]{2})+$/i.test(a.bytes)||a.bytes.length>MAX_FILE_BYTES*2+2)throw new Error('Invalid draft asset.');
    const pairs=(a.bytes as string).slice(2).match(/../g)!;
    const bytes=Uint8Array.from(pairs,h=>parseInt(h,16));
    const checked=await makeAsset(k,String(a.name),String(a.mime),bytes,Number(a.originalBytes)||bytes.length);
    if(a.sha256!==checked.sha256||a.keccak!==checked.keccak)throw new Error(`Integrity check failed for ${k}.`);
    d.assets[k]=checked;
  } return d;
}
export function download(name:string,contents:BlobPart,type='application/json') {
  const url=URL.createObjectURL(new Blob([contents],{type})); const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
