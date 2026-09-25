import {makeAsset,MAX_FILE_BYTES,type ContentAsset,type Draft} from './assets';

export const CAPSULE_SCHEMA='carve.agent-capsule/1';
export const MUSE_CHANNELS=['lobby','townsquare','museideas','skillexchange','memecoins','townhall'] as const;
export type MusePost={id:number;museId:string;name:string;text:string;createdAt:string;channel:string;excerpt:boolean};
export type MuseIdentity={museId:string;name:string;bio:string;publicKey:string|null};
export type MuseSnapshot={identity:MuseIdentity;capturedAt:string;channel:string;posts:MusePost[]};
export type AgentCapsule={schema:typeof CAPSULE_SCHEMA;name:string;purpose:string;personality:string;instructions:string;createdAt:string;source:MuseSnapshot|null;attachment:{name:string;base64:string}|null};
export type CapsuleInput=Pick<AgentCapsule,'name'|'purpose'|'personality'|'instructions'|'source'>;
const encoder=new TextEncoder();
const text=(v:unknown,max:number,required=false):string=>{
 if(typeof v!=='string'||v.length>max||(required&&!v.trim()))throw new Error('A capsule field is missing or exceeds its size limit.');
 return v;
};
const record=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('Invalid capsule data.');return v as Record<string,unknown>;};
const date=(v:unknown)=>{const s=text(v,40,true);if(!/^\d{4}-\d{2}-\d{2}T/.test(s)||!Number.isFinite(Date.parse(s)))throw new Error('Invalid capture date.');return s;};
export function museIdFromInput(input:string){
 const s=input.trim();
 if(/^muse_[a-zA-Z0-9_-]{1,80}$/.test(s))return s;
 try{const u=new URL(s);if(u.protocol==='https:'&&['musebook.me','musebook.lol'].includes(u.hostname)&&!u.username&&!u.password&&!u.port){const m=u.pathname.match(/^\/residents\/(muse_[a-zA-Z0-9_-]{1,80})\/?$/);if(m)return m[1];}}catch{}
 throw new Error('Paste a Musebook profile link or a muse_ ID.');
}
export function selectSnapshotPosts(snapshot:MuseSnapshot,ids:number[],available:MusePost[]=snapshot.posts):MuseSnapshot{
 if(!ids.length||ids.length>8||new Set(ids).size!==ids.length)throw new Error('Choose 1–8 different posts.');
 const posts=ids.map(id=>{const post=available.find(p=>p.id===id);if(!post)throw new Error('This post is not in the captured source.');return post;});
 return parseSnapshot({...snapshot,posts});
}
export function parseMuseIdentity(value:unknown):MuseIdentity{
 const v=record(value);const museId=museIdFromInput(text(v.museId,90,true));
 const publicKey=v.publicKey===null?null:text(v.publicKey,43,true);
 if(publicKey!==null&&!/^[A-Za-z0-9_-]{43}$/.test(publicKey))throw new Error('Invalid public identity key.');
 return {museId,name:text(v.name,128,true),bio:text(v.bio,2000),publicKey};
}
export function parseMusePost(value:unknown):MusePost{
 const v=record(value);
 if(!Number.isSafeInteger(v.id)||Number(v.id)<1)throw new Error('Invalid public post ID.');
 const channel=text(v.channel,32,true);if(!MUSE_CHANNELS.includes(channel as typeof MUSE_CHANNELS[number]))throw new Error('Unsupported public channel.');
 if(typeof v.excerpt!=='boolean')throw new Error('Invalid excerpt marker.');
 return {id:Number(v.id),museId:museIdFromInput(text(v.museId,90,true)),name:text(v.name,128,true),text:text(v.text,2000,true),createdAt:text(v.createdAt,40,true),channel,excerpt:v.excerpt};
}
export function parseSnapshot(value:unknown):MuseSnapshot{
 const v=record(value),identity=parseMuseIdentity(v.identity),channel=text(v.channel,32,true);
 if(!MUSE_CHANNELS.includes(channel as typeof MUSE_CHANNELS[number])||!Array.isArray(v.posts)||v.posts.length>8||!v.posts.length)throw new Error('Choose 1–8 public posts from one channel.');
 const posts=v.posts.map(parseMusePost);
 if(new Set(posts.map(p=>p.id)).size!==posts.length||posts.some(p=>p.museId!==identity.museId||p.channel!==channel))throw new Error('Snapshot posts do not match this muse and channel.');
 return {identity,capturedAt:date(v.capturedAt),channel,posts};
}
export function parseCapsule(value:unknown):AgentCapsule{
 const v=record(value);if(v.schema!==CAPSULE_SCHEMA)throw new Error('Unknown capsule version.');
 let attachment:AgentCapsule['attachment']=null;
 if(v.attachment!==null){const a=record(v.attachment),base64=text(a.base64,Math.ceil(MAX_FILE_BYTES/3)*4,true);if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))throw new Error('Invalid website attachment.');attachment={name:text(a.name,160,true),base64};}
 return {schema:CAPSULE_SCHEMA,name:text(v.name,64,true),purpose:text(v.purpose,600,true),personality:text(v.personality,600),instructions:text(v.instructions,6000),createdAt:date(v.createdAt),source:v.source===null?null:parseSnapshot(v.source),attachment};
}
function base64(bytes:Uint8Array){let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(raw);}
export function attachmentBytes(capsule:AgentCapsule){if(!capsule.attachment)return null;return Uint8Array.from(atob(capsule.attachment.base64),c=>c.charCodeAt(0));}
function escapeHTML(s:string){return s.replace(/[&<>"'=(@]/g,c=>'&#'+c.charCodeAt(0)+';');}
export function capsuleJSON(capsule:AgentCapsule){return JSON.stringify(parseCapsule(capsule));}
export function capsuleHTML(capsule:AgentCapsule){
 const c=parseCapsule(capsule),safeJSON=capsuleJSON(c).replace(/[<>&=(@\u2028\u2029]/g,ch=>'\\u'+ch.charCodeAt(0).toString(16).padStart(4,'0'));
 const section=(name:string,value:string)=>value?'<section><h2>'+name+'</h2><p>'+escapeHTML(value)+'</p></section>':'';
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escapeHTML(c.name)+' · Carve Agent Capsule</title><style>body{margin:0;background:#061510;color:#e5f3e9;font:16px/1.6 system-ui,sans-serif}main{max-width:720px;margin:auto;padding:32px 24px}h1{font-size:36px;line-height:1.15}h2{font-size:18px;color:#a3ecc1}p{white-space:pre-wrap;overflow-wrap:anywhere}.label{letter-spacing:.14em;font-size:12px;color:#86cba4}section{border-top:1px solid #284638;padding:14px 0}small{color:#adbcaf}blockquote{margin:12px 0;padding:12px 16px;background:#10261d;border-radius:8px}code{overflow-wrap:anywhere}</style></head><body><main><div class="label">CARVE / AGENT CAPSULE</div><h1>'+escapeHTML(c.name)+'</h1><p>'+escapeHTML(c.purpose)+'</p><small>Public blueprint'+(c.source?' + attributed Musebook snapshot':'')+'. Not a running AI. No wallet permissions or autonomous execution.</small>'+section('Personality',c.personality)+section('Public instructions',c.instructions)+(c.source?'<section><h2>Musebook snapshot</h2><p>Source identity: '+escapeHTML(c.source.identity.name)+' · '+escapeHTML(c.source.identity.museId)+'</p><p>Captured: '+escapeHTML(c.source.capturedAt)+' · #'+escapeHTML(c.source.channel)+'</p><small>Public source data, not proof of ownership, endorsement or authorship. Original post signatures were not supplied by the public feed. This is a fixed snapshot, not live conversation.</small>'+c.source.posts.map(p=>'<blockquote><p>'+escapeHTML(p.text)+'</p><small>Post '+p.id+' · '+escapeHTML(p.createdAt)+(p.excerpt?' · excerpt':'')+'</small></blockquote>').join('')+'</section>':'')+(c.attachment?'<section><h2>Attached website</h2><p>'+escapeHTML(c.attachment.name)+'</p><small>Original bytes are preserved in this file’s structured data. Download through Carve’s capsule inspector. Attachment code is not executed here.</small></section>':'')+'<section><small>Created '+escapeHTML(c.createdAt)+'. Publication status must be checked against a token’s websiteRoot on Robinhood Chain. This file alone is not proof of an inscription.</small></section><script type="application/json" id="carve-agent-capsule">'+safeJSON+'</script></main></body></html>';
}
export function readCapsuleHTML(bytes:Uint8Array):AgentCapsule|null{
 if(bytes.length>MAX_FILE_BYTES)return null;
 try{const html=new TextDecoder('utf-8',{fatal:true}).decode(bytes),matches=[...html.matchAll(/<script type="application\/json" id="carve-agent-capsule">([^]*?)<\/script>/g)];if(matches.length!==1)return null;return parseCapsule(JSON.parse(matches[0][1]));}catch{return null;}
}
export async function prepareCapsule(input:CapsuleInput,existing?:ContentAsset,now=new Date().toISOString()){
 const previous=existing?readCapsuleHTML(existing.bytes):null;
 const capsule=parseCapsule({...input,schema:CAPSULE_SCHEMA,createdAt:now,attachment:previous?.attachment??(existing&&!previous?{name:existing.name.slice(0,160),base64:base64(existing.bytes)}:null)});
 const asset=await makeAsset('website','agent-capsule.html','text/html',encoder.encode(capsuleHTML(capsule)));
 return {capsule,asset};
}
export function stageCapsule(draft:Draft,asset:ContentAsset):Draft{
 if(asset.kind!=='website'||!readCapsuleHTML(asset.bytes))throw new Error('Not a prepared agent capsule.');
 return {...draft,assets:{...draft.assets,website:asset},updatedAt:Date.now()};
}
