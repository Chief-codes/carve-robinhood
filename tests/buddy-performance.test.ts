import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
import {visibleAnimation} from '../src/components/animation-scheduler';

test('lossless buddy stays below 220 KB, later original-resolution scenes remain deferred',()=>{
 assert.ok(statSync('src/assets/buddy/buddy.webp').size<220000);
 for(const f of ['jump','walk','sit','leaning','computer','computer-plate'])assert.ok(statSync(`src/assets/buddy/${f}.webp`).size<1500000);
 for(const f of ['buddy','jump','walk','sit','leaning','computer','computer-plate'])assert.ok(readFileSync(`src/assets/buddy/${f}.webp`).includes(Buffer.from('VP8L')),'lossless WebP required');
 const prep=readFileSync('scripts/prepare-buddy-assets.mjs','utf8');assert.match(prep,/lossless:true/);assert.match(prep,/'leaning',1254/);assert.match(prep,/'computer',1254/);
 const runtime=readFileSync('src/components/buddy-runtime.ts','utf8');assert.match(runtime,/eyes\.webp/);
 const source=readFileSync('src/components/CarveScrollMascot.ts','utf8');assert.match(source,/progress>\.58&&!gazeRequested/);
 assert.ok(statSync('public/brand/carve-mascot-512.png').size>300000);
});
test('first-visit page has a native buddy fallback, deferred tutorial, route splitting and shared theme',()=>{
 const intro=readFileSync('src/components/CarveIntroduction.tsx','utf8'),demo=readFileSync('src/components/CarveLaunchDemo.tsx','utf8'),app=readFileSync('src/App.tsx','utf8');
 assert.match(intro,/className="carve-buddy-fallback"/);assert.match(intro,/fetchPriority="high"/);
 assert.match(demo,/preload="none"/);assert.doesNotMatch(demo,/<video[^>]*\ssrc=/);
 assert.match(app,/const Studio=lazy/);assert.doesNotMatch(app,/route==='studio'\?'dark'/);
 assert.match(readFileSync('index.html','utf8'),/data-carve-theme="light"/);
});
test('animation clock sleeps offscreen and in background tabs, and cleans up all scheduled work',()=>{
 const previous=Object.fromEntries(['window','document','IntersectionObserver','requestAnimationFrame','cancelAnimationFrame','clearTimeout'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 let id=0,painted=0;const frames=new Map<number,FrameRequestCallback>(),timers=new Map<number,()=>void>(),listeners=new Map<string,()=>void>();
 let observe:(entries:{isIntersecting:boolean}[])=>void=()=>{};
 const doc={hidden:false,addEventListener:(n:string,f:()=>void)=>listeners.set(n,f),removeEventListener:(n:string)=>listeners.delete(n)};
 try{
  Object.assign(globalThis,{document:doc,window:{setTimeout:(f:()=>void)=>{timers.set(++id,f);return id;}},clearTimeout:(i:number)=>timers.delete(i),requestAnimationFrame:(f:FrameRequestCallback)=>{frames.set(++id,f);return id;},cancelAnimationFrame:(i:number)=>frames.delete(i),IntersectionObserver:class{constructor(f:typeof observe){observe=f;}observe(){}disconnect(){}}});
  const loop=visibleAnimation({} as Element,()=>{painted++;return 4000;});
  const frame=()=>{const entry=frames.entries().next().value!;assert.ok(entry);frames.delete(entry[0]);entry[1](100);};
  assert.equal(frames.size,0);observe([{isIntersecting:true}]);frame();assert.equal(painted,1);assert.equal(frames.size,0);assert.equal(timers.size,1);
  doc.hidden=true;listeners.get('visibilitychange')!();assert.equal(timers.size,0);loop.wake();assert.equal(frames.size,0);
  doc.hidden=false;listeners.get('visibilitychange')!();frame();assert.equal(painted,2);
  observe([{isIntersecting:false}]);assert.equal(timers.size,0);assert.equal(frames.size,0);
  observe([{isIntersecting:true}]);loop.setEnabled(false);assert.equal(frames.size,0);
  loop.setEnabled(true);assert.equal(frames.size,1);loop.destroy();assert.equal(frames.size,0);assert.equal(timers.size,0);assert.equal(listeners.size,0);
 }finally{for(const [k,d] of Object.entries(previous)){if(d)Object.defineProperty(globalThis,k,d);else Reflect.deleteProperty(globalThis,k);}}
});
