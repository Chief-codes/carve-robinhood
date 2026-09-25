import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareCapsule,readCapsuleHTML,capsuleJSON,capsuleHTML,attachmentBytes,parseCapsule,parseSnapshot,museIdFromInput,selectSnapshotPosts,stageCapsule,type CapsuleInput} from '../src/lib/agent-capsule.ts';
import {newDraft,makeAsset,exportDraft,importDraft,externalReferences,MAX_FILE_BYTES} from '../src/lib/assets.ts';
import {validateMediaBytes} from '../src/lib/inscriptions.ts';
import {handleMusebook} from '../netlify/functions/musebook.ts';

const input:CapsuleInput={name:'Test capsule',purpose:'Archive evidence, not promises.',personality:'Clear and careful.',instructions:'Never invent a receipt.',source:null};
const now='2026-09-23T00:00:00.000Z';
const identity={museId:'muse_test',name:'Test muse',bio:'Fixture only',publicKey:'A'.repeat(43)};
const post={id:1,museId:'muse_test',name:'Test muse',text:'Test fixture — not live activity.',createdAt:'2026-09-23 00:00:00',channel:'lobby',excerpt:false};
const snapshot={identity,capturedAt:now,channel:'lobby',posts:[post]};
test('capsule bytes are deterministic, inspectable and accepted by the current inscription validator',async()=>{
 const a=await prepareCapsule(input,undefined,now),b=await prepareCapsule(input,undefined,now);
 assert.equal(a.asset.keccak,b.asset.keccak);assert.deepEqual(readCapsuleHTML(a.asset.bytes),a.capsule);
 validateMediaBytes(a.asset);assert.deepEqual(externalReferences(new TextDecoder().decode(a.asset.bytes)),[]);
 assert.equal(JSON.parse(capsuleJSON(a.capsule)).instructions,input.instructions);
});
test('hostile source text stays inert and survives exact JSON reconstruction',async()=>{
 const attack='</script><script>alert(1)</script><img src="https://bad.invalid/pixel"> url(https://bad.invalid) @import "https://bad.invalid/a"; <meta http-equiv=refresh content="0; url=https://bad.invalid">';
 const {asset,capsule}=await prepareCapsule({...input,name:'<tag>&',instructions:attack,source:{...snapshot,posts:[{...post,text:attack}]}},undefined,now);
 const html=new TextDecoder().decode(asset.bytes);assert.equal(html.includes('<img src='),false);assert.equal(html.includes('<script>alert'),false);assert.deepEqual(externalReferences(html),[]);
 validateMediaBytes(asset);assert.equal(readCapsuleHTML(asset.bytes)?.instructions,attack);assert.equal(readCapsuleHTML(asset.bytes)?.source?.posts[0].text,attack);assert.equal(capsule.name,'<tag>&');
});
test('a website is preserved byte for byte without being executed, even across repeated editing',async()=>{
 const original=await makeAsset('website','original.html','text/html',new TextEncoder().encode('<!doctype html><h1>🌱</h1><script>window.risky=1</script>'));
 const first=await prepareCapsule(input,original,now),second=await prepareCapsule({...input,name:'Edited'},first.asset,now);
 assert.deepEqual(attachmentBytes(first.capsule),original.bytes);assert.deepEqual(attachmentBytes(second.capsule),original.bytes);
 assert.equal(new TextDecoder().decode(first.asset.bytes).includes('window.risky=1'),false);
});
test('staging preserves image, audio, identity, fees and buyback and works in draft exports',async()=>{
 const d=newDraft();d.name='Existing';d.symbol='OLD';d.initialBuy='0.01';d.creatorFee='1';d.autoBuyback=true;
 d.assets.image=await makeAsset('image','x.png','image/png',new Uint8Array([1]));d.assets.audio=await makeAsset('audio','x.wav','audio/wav',new Uint8Array([2]));
 const p=await prepareCapsule(input,undefined,now),next=stageCapsule(d,p.asset);
 assert.equal(next.assets.image,d.assets.image);assert.equal(next.assets.audio,d.assets.audio);assert.equal(next.name,'Existing');assert.equal(next.symbol,'OLD');assert.equal(next.initialBuy,'0.01');assert.equal(next.autoBuyback,true);assert.equal(next.creatorFee,'1');assert.equal(d.assets.website,undefined);
 const imported=await importDraft(exportDraft(next));assert.deepEqual(readCapsuleHTML(imported.assets.website!.bytes),p.capsule);
 const tampered=JSON.parse(exportDraft(next));tampered.assets.website.bytes='0x1234';await assert.rejects(importDraft(JSON.stringify(tampered)),/Integrity/);
});
test('invalid, duplicate and mixed-identity snapshots fail closed',()=>{
 assert.deepEqual(parseSnapshot(snapshot),snapshot);
 for(const s of [{...snapshot,posts:[]},{...snapshot,posts:[post,post]},{...snapshot,posts:[{...post,museId:'muse_other'}]},{...snapshot,channel:'founders'},{...snapshot,posts:[{...post,channel:'townhall'}]},{...snapshot,posts:Array.from({length:9},(_,i)=>({...post,id:i+1}))}])assert.throws(()=>parseSnapshot(s));
});
test('only public Musebook resident URLs and bounded IDs are accepted',()=>{
 assert.equal(museIdFromInput('https://musebook.lol/residents/muse_test'),'muse_test');
 assert.equal(museIdFromInput('https://musebook.me/residents/muse_test'),'muse_test');assert.equal(museIdFromInput('muse_test'),'muse_test');
 for(const s of ['https://evil.invalid/residents/muse_test','https://musebook.me.evil.invalid/residents/muse_test','https://u:p@musebook.me/residents/muse_test','http://musebook.me/residents/muse_test','https://musebook.me:8443/residents/muse_test','../','muse_'+'x'.repeat(100)])assert.throws(()=>museIdFromInput(s));
});
test('post selection preserves exact source bytes and attribution without changing the original snapshot',()=>{
 const other={...post,id:2,text:'A second public post'};
 const next=selectSnapshotPosts(snapshot,[2],[post,other]);
 assert.deepEqual(next.posts,[other]);assert.deepEqual(next.identity,identity);assert.equal(next.capturedAt,now);assert.deepEqual(snapshot.posts,[post]);
});
test('post selection enforces 1–8 unique captured posts of the same muse and channel',()=>{
 const available=Array.from({length:9},(_,i)=>({...post,id:i+1}));
 assert.equal(selectSnapshotPosts(snapshot,available.slice(0,8).map(p=>p.id),available).posts.length,8);
 for(const ids of [[],[1,1],[99],available.map(p=>p.id)])assert.throws(()=>selectSnapshotPosts(snapshot,ids,available));
 assert.throws(()=>selectSnapshotPosts(snapshot,[2],[{...post,id:2,museId:'muse_else'}]));
 assert.throws(()=>selectSnapshotPosts(snapshot,[2],[{...post,id:2,channel:'townhall'}]));
});
test('malformed capsule markers, versions, dates, fields and attachments are rejected',async()=>{
 const {capsule,asset}=await prepareCapsule(input,undefined,now);
 assert.throws(()=>parseCapsule({...capsule,schema:'fake'}));assert.throws(()=>parseCapsule({...capsule,name:''}));assert.throws(()=>parseCapsule({...capsule,createdAt:'not a date'}));assert.throws(()=>parseCapsule({...capsule,instructions:'x'.repeat(6001)}));assert.throws(()=>parseCapsule({...capsule,attachment:{name:'x',base64:'%%%'}}));
 assert.equal(readCapsuleHTML(new TextEncoder().encode(capsuleHTML(capsule)+capsuleHTML(capsule))),null);assert.equal(readCapsuleHTML(new Uint8Array([0xff])),null);assert.equal(readCapsuleHTML(new Uint8Array(MAX_FILE_BYTES+1)),null);
 assert.ok(asset.bytes.length<24*1024);
});
test('oversized wrapped website is rejected before altering any launch draft',async()=>{
 const website=await makeAsset('website','huge.html','text/html',new Uint8Array(MAX_FILE_BYTES));
 await assert.rejects(prepareCapsule(input,website,now),/under 1 MB/);
});
const rawPost={id:1,muse_id:'muse_test',name:'Test muse',text:post.text,created_at:post.createdAt,channel:'lobby'};
const response=(data:unknown)=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
test('public proxy uses only fixed hosts, GET, no redirects or credentials; preserves attribution',async()=>{
 const calls:string[]=[];
 const fake:typeof fetch=async(url,options)=>{calls.push(String(url));assert.equal(options?.method,'GET');assert.equal(options?.redirect,'error');assert.equal(new URL(String(url)).origin,'https://musebook.me');return String(url).includes('identity.json')?response({ok:true,identity:{muse_id:'muse_test',name:'Test muse',bio:'',public_key:'A'.repeat(43),key_alg:'ed25519'}}):response({posts:[rawPost,{...rawPost,id:2,muse_id:'muse_other'}]});};
 const r=await handleMusebook(new Request('https://carve.invalid/api/musebook?channel=lobby&muse_id=muse_test'),fake),data=await r.json();
 assert.equal(r.status,200);assert.equal(data.posts.length,1);assert.equal(data.identity.museId,'muse_test');assert.equal(calls.length,2);assert.equal(r.headers.get('Netlify-Vary'),'query=channel|muse_id');assert.ok(r.headers.get('Netlify-CDN-Cache-Control')?.includes('max-age=10'));assert.equal(r.headers.get('Cache-Control'),'public, max-age=0, must-revalidate');
});
test('proxy refuses writes, private channels, URL injection, duplicates and unexpected parameters before fetching',async()=>{
 const never:typeof fetch=async()=>{assert.fail('Must not fetch');};
 for(const query of ['?channel=founders','?url=http://127.0.0.1','?muse_id=../secret','?channel=lobby&channel=townhall','?muse_id=muse_test&muse_id=muse_other'])assert.equal((await handleMusebook(new Request('https://carve.invalid/api/musebook'+query),never)).status,400);
 assert.equal((await handleMusebook(new Request('https://carve.invalid/api/musebook',{method:'POST'}),never)).status,405);
});
test('missing source never becomes demo data; oversized and invalid content is rejected',async()=>{
 for(const fake of [async()=>{throw new Error('offline');},async()=>new Response('Not JSON'),async()=>new Response('{}',{headers:{'content-type':'application/json','content-length':'9999999'}}),async()=>response({posts:[{bad:true}]}),async()=>response({missing:true}),async()=>new Response('x'.repeat(600000),{headers:{'content-type':'application/json'}})]){
  const r=await handleMusebook(new Request('https://carve.invalid/api/musebook'),fake as typeof fetch);assert.equal(r.status,502);const data=await r.json();assert.equal(data.posts,undefined);assert.equal(r.headers.get('Cache-Control'),'no-store');
 }
});
test('public proxy caps feed length and marks excerpts instead of pretending to preserve a full post',async()=>{
 const fake:typeof fetch=async()=>response({posts:Array.from({length:100},(_,i)=>({...rawPost,id:i+1,text:'z'.repeat(2100)}))});
 const r=await handleMusebook(new Request('https://carve.invalid/api/musebook'),fake),data=await r.json();assert.equal(data.posts.length,50);assert.equal(data.posts[0].text.length,2000);assert.equal(data.posts[0].excerpt,true);
});
