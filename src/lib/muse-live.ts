import {parseMusePost,type MusePost} from './agent-capsule';
export type LiveMusePost=MusePost&{parentPostId:number|null};
export type MuseFeed={retrievedAt:string;channel:string;posts:LiveMusePost[]};
export function parseMuseFeed(data:unknown,channel:string):MuseFeed{
 const d=data as Record<string,unknown>;
 if(!d||d.source!=='https://musebook.me'||d.channel!==channel||!Array.isArray(d.posts)||d.posts.length>50||typeof d.retrievedAt!=='string'||!Number.isFinite(Date.parse(d.retrievedAt)))throw new Error('Invalid public feed response.');
 const seen=new Set<number>();
 const posts=d.posts.map(raw=>{const p=parseMusePost(raw);if(p.channel!==channel)throw new Error('Source channel mismatch.');return {...p,parentPostId:Number.isSafeInteger(raw.parentPostId)&&raw.parentPostId>0?raw.parentPostId:null} as LiveMusePost;}).filter(p=>{if(seen.has(p.id))return false;seen.add(p.id);return true;}).sort((a,b)=>b.id-a.id);
 return {retrievedAt:d.retrievedAt,channel,posts};
}
export type LiveStatus='checking'|'live'|'paused'|'offline'|'reconnecting';
/** One request at a time; pause hidden/offline, bounded retries, no synthetic data. */
export function pollMuseFeed<T>(run:(signal:AbortSignal)=>Promise<T>,value:(v:T)=>void,status:(s:LiveStatus,error?:string)=>void){
 let stopped=false,timer=0,pending:AbortController|null=null,failures=0,lastStart=0;
 const available=()=>!document.hidden&&navigator.onLine!==false;
 const clear=()=>{clearTimeout(timer);timer=0;};
 const schedule=(delay:number)=>{clear();if(!stopped&&available())timer=window.setTimeout(()=>void refresh(),delay);};
 const refresh=async()=>{
  if(stopped||pending)return;
  if(!available()){status(navigator.onLine===false?'offline':'paused');return;}
  const since=Date.now()-lastStart;if(lastStart&&since<5000){schedule(5000-since);return;}
  clear();const abort=new AbortController();pending=abort;lastStart=Date.now();status('checking');
  try{const v=await run(abort.signal);if(stopped||abort.signal.aborted)return;failures=0;value(v);status('live');}
  catch(e){if(stopped||abort.signal.aborted)return;failures++;status('reconnecting',e instanceof Error?e.message:'Public source unavailable.');}
  finally{if(pending===abort)pending=null;if(!stopped&&!abort.signal.aborted)schedule(failures?Math.min(120000,15000*2**failures):15000);}
 };
 const changed=()=>{clear();if(!available()){pending?.abort();pending=null;status(navigator.onLine===false?'offline':'paused');}else void refresh();};
 document.addEventListener('visibilitychange',changed);window.addEventListener('online',changed);window.addEventListener('offline',changed);
 void refresh();
 return {refresh,destroy(){stopped=true;clear();pending?.abort();pending=null;document.removeEventListener('visibilitychange',changed);window.removeEventListener('online',changed);window.removeEventListener('offline',changed);}};
}
