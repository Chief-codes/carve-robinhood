import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeAsset,splitChunks,planAssets,exportDraft,importDraft,newDraft,validateDraft,isolatedHtml,externalReferences,CHUNK_BYTES,MAX_FILE_BYTES} from '../src/lib/assets.ts';
import {walletBrand,walletCatalog} from '../src/lib/wallet-catalog.ts';
test('chunking preserves every byte at boundaries',()=>{
 for(const size of [0,1,CHUNK_BYTES-1,CHUNK_BYTES,CHUNK_BYTES+1,3*CHUNK_BYTES]){
  const bytes=Uint8Array.from({length:size},(_,i)=>i%256),chunks=splitChunks(bytes);
  assert.equal(chunks.length,Math.ceil(size/CHUNK_BYTES));assert.ok(chunks.every(c=>c.length<=CHUNK_BYTES));
  assert.deepEqual(Uint8Array.from(chunks.flatMap(c=>[...c])),bytes);
 }
});
test('asset preparation validates type, size and emptiness',async()=>{
 await assert.rejects(makeAsset('image','bad.svg','image/svg+xml',new Uint8Array([1])),/Unsupported/);
 await assert.rejects(makeAsset('audio','empty.mp3','audio/mpeg',new Uint8Array()),/empty/);
 await assert.rejects(makeAsset('website','huge.html','text/html',new Uint8Array(MAX_FILE_BYTES+1)),/under 1 MB/);
});
test('audio codec MIME parameters normalize for recording',async()=>{
 const asset=await makeAsset('audio','recording','audio/webm;codecs=opus',new Uint8Array([1,2,3]));assert.equal(asset.mime,'audio/webm');assert.equal(asset.sha256.length,66);
});
test('storage plan counts per-asset manifests and chunks',async()=>{
 const website=await makeAsset('website','index.html','text/html',new Uint8Array(CHUNK_BYTES+1));
 const audio=await makeAsset('audio','a.mp3','audio/mpeg',new Uint8Array(100));
 const plan=planAssets({website,audio});assert.equal(plan.files,2);assert.equal(plan.chunks,3);assert.equal(plan.uploadTransactions,5);assert.equal(plan.bytes,CHUNK_BYTES+101);
});
test('export/import roundtrip retains exact bytes and identity',async()=>{
 const d=newDraft();d.name='Carve QA';d.symbol='QA';d.assets.website=await makeAsset('website','index.html','text/html',new TextEncoder().encode('<h1>Hi</h1>'));
 const restored=await importDraft(exportDraft(d));assert.equal(restored.name,d.name);assert.deepEqual(restored.assets.website,d.assets.website);
});
test('import rejects tampered data and malformed files',async()=>{
 const d=newDraft();d.assets.website=await makeAsset('website','index.html','text/html',new Uint8Array([1,2,3]));
 const json=JSON.parse(exportDraft(d));json.assets.website.bytes='0x040506';await assert.rejects(importDraft(JSON.stringify(json)),/Integrity check failed/);
 await assert.rejects(importDraft('{"version":9}'),/Not a Carve/);
});
test('draft validation does not present invalid amounts as valid',()=>{
 const d=newDraft();assert.equal(validateDraft(d).length,3);d.name='valid';d.symbol='OK';d.initialBuy='1e3';assert.ok(validateDraft(d).some(s=>s.includes('valid ETH')));d.initialBuy='0.001';assert.ok(!validateDraft(d).some(s=>s.includes('valid ETH')));
 d.name='🌳'.repeat(20);assert.ok(validateDraft(d).some(s=>s.includes('UTF-8')));
});
test('all seven non-empty media combinations are allowed; an empty launch is rejected',async()=>{
 const kinds=['image','audio','website'] as const;
 const assets=[await makeAsset('image','x.png','image/png',new Uint8Array([1])),await makeAsset('audio','x.wav','audio/wav',new Uint8Array([1])),await makeAsset('website','x.html','text/html',new TextEncoder().encode('<h1>Hello</h1>'))];
 for(let mask=0;mask<8;mask++){
  const d=newDraft();d.name='Media';d.symbol='MEDIA';
  kinds.forEach((kind,i)=>{if(mask&(1<<i))d.assets[kind]=assets[i];});
  assert.equal(validateDraft(d).length,mask?0:1,'combination '+mask);
 }
});
test('isolated HTML blocks external network and forms by default',()=>{
 const html=isolatedHtml('<h1>Untrusted</h1>');assert.ok(html.includes("connect-src 'none'"));assert.ok(html.includes("form-action 'none'"));assert.ok(html.indexOf('Content-Security-Policy')<html.indexOf('<h1>'));
 assert.deepEqual(externalReferences('<img src="/a.png"><img src="data:image/png;base64,AA"><a href="#anchor">x</a><style>x{background:url(https://a.example/x)}</style>'),['/a.png','https://a.example/x']);
});
test('wallet catalog uses distinct identities and optimized asset names',()=>{
 assert.equal(walletCatalog.length,14);assert.equal(new Set(walletCatalog.map(w=>w[2])).size,14);assert.equal(walletBrand('io.metamask')?.[0],'metamask');assert.equal(walletBrand('io.rabby')?.[0],'rabby');assert.equal(walletBrand('app.backpack.mobile')?.[0],'backpack');assert.equal(walletBrand('unknown'),undefined);
});
test('HTML preflight also finds unquoted, srcset, CSS import and refresh resources',()=>{
 const html='<img src=/hero.png srcset="small.png 1x, large.png 2x"><style>@import "theme.css";</style><meta http-equiv=refresh content="0; url=https://example.com"><img src="data:image/png;base64,AA">';
 const refs=externalReferences(html);
 for(const item of ['/hero.png','small.png','large.png','theme.css','https://example.com'])assert.ok(refs.includes(item),item);
 assert.ok(refs.every(r=>!r.startsWith('data:')));
});
