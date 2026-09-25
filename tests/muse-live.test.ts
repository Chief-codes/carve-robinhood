import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMuseFeed,pollMuseFeed} from '../src/lib/muse-live';
const post={id:1,museId:'muse_test',name:'Fixture',text:'Test only',createdAt:'2026-09-25 12:00:00',channel:'lobby',excerpt:false};
const feed={source:'https://musebook.me',channel:'lobby',retrievedAt:'2026-09-25T12:00:00Z',posts:[post]};
test('live feed validates source, deduplicates, sorts and preserves safe reply links',()=>{
 const parsed=parseMuseFeed({...feed,posts:[post,{...post,id:2,parentPostId:1},post]},'lobby');
 assert.deepEqual(parsed.posts.map(p=>p.id),[2,1]);assert.equal(parsed.posts[0].parentPostId,1);assert.equal(parsed.posts[1].parentPostId,null);
 for(const d of [null,{}, {...feed,source:'https://evil.invalid'},{...feed,channel:'townhall'},{...feed,retrievedAt:'invalid'},{...feed,posts:[{...post,channel:'townhall'}]}])assert.throws(()=>parseMuseFeed(d,'lobby'));
});
test('live poll never overlaps; retains data on failure, backs off, pauses and cleans up',async()=>{
 const keys=['window','document','navigator','clearTimeout'],before=Object.fromEntries(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));const originalNow=Date.now;
 const timers=new Map<number,{fn:()=>void;delay:number}>(),events=new Map<string,()=>void>();let time=10000,next=0,calls=0;
 let complete:(v:number)=>void=()=>{},fail:(e:Error)=>void=()=>{};const values:number[]=[],statuses:string[]=[],signals:AbortSignal[]=[];
 const doc={hidden:false,addEventListener:(n:string,f:()=>void)=>events.set(n,f),removeEventListener:(n:string)=>events.delete(n)};
 const nav={onLine:true};
 try{
  Object.defineProperties(globalThis,{window:{configurable:true,value:{setTimeout:(fn:()=>void,delay:number)=>{timers.set(++next,{fn,delay});return next;},addEventListener:doc.addEventListener,removeEventListener:doc.removeEventListener}},document:{configurable:true,value:doc},navigator:{configurable:true,value:nav},clearTimeout:{configurable:true,value:(n:number)=>timers.delete(n)}});Date.now=()=>time;
  const poll=pollMuseFeed(signal=>{calls++;signals.push(signal);return new Promise<number>((resolve,reject)=>{complete=resolve;fail=reject;});},v=>values.push(v),s=>statuses.push(s));
  const flush=async()=>{await Promise.resolve();await Promise.resolve();};
  const tick=()=>{const [id,t]=timers.entries().next().value!;timers.delete(id);time+=t.delay;t.fn();};
  assert.equal(calls,1);await poll.refresh();assert.equal(calls,1);
  complete(1);await flush();assert.deepEqual(values,[1]);assert.equal([...timers.values()][0].delay,15000);
  tick();assert.equal(calls,2);fail(new Error('temporary'));await flush();assert.deepEqual(values,[1]);assert.equal(statuses.at(-1),'reconnecting');assert.equal([...timers.values()][0].delay,30000);
  tick();assert.equal(calls,3);doc.hidden=true;events.get('visibilitychange')!();assert.equal(signals.at(-1)?.aborted,true);complete(3);await flush();assert.deepEqual(values,[1]);assert.equal(timers.size,0);
  doc.hidden=false;time+=5000;events.get('visibilitychange')!();assert.equal(calls,4);nav.onLine=false;events.get('offline')!();assert.equal(statuses.at(-1),'offline');complete(4);await flush();assert.deepEqual(values,[1]);
  time+=5000;nav.onLine=true;events.get('online')!();complete(5);await flush();assert.deepEqual(values,[1,5]);
  poll.destroy();assert.equal(timers.size,0);assert.equal(events.size,0);await poll.refresh();assert.equal(calls,5);
 }finally{Date.now=originalNow;for(const [k,d] of Object.entries(before)){if(d)Object.defineProperty(globalThis,k,d);else Reflect.deleteProperty(globalThis,k);}}
});
