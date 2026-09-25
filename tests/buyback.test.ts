import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encodeFunctionData,decodeFunctionData,zeroHash} from 'viem';
import {AUTO_FACTORY_ABI,CURVE_FACTORY_ABI} from '../src/lib/curve-contracts';
import {DEPLOYMENT,CURVE_DEPLOYMENT} from '../src/lib/chain';
import {newDraft,exportDraft,importDraft,validateDraft} from '../src/lib/assets';
import {readBuybackStats} from '../src/lib/buyback';
import {readFileSync} from 'node:fs';
import {inspectGif} from '../src/lib/gif';
test('version 5 ABI encodes the exact opt-in flag; old signature remains distinct',()=>{
 for(const enabled of [false,true]){
  const args=['Test','TEST',zeroHash,zeroHash,zeroHash,100,enabled,0n,9999n] as const;
  const data=encodeFunctionData({abi:AUTO_FACTORY_ABI,functionName:'launch',args});
  assert.deepEqual(decodeFunctionData({abi:AUTO_FACTORY_ABI,data}).args,args);
  const old=encodeFunctionData({abi:CURVE_FACTORY_ABI,functionName:'launch',args:['Test','TEST',zeroHash,zeroHash,zeroHash,100,0n,9999n]});
  assert.notEqual(data.slice(0,10),old.slice(0,10));
 }
 assert.equal(DEPLOYMENT.curveVersion,5);assert.equal(CURVE_DEPLOYMENT.curveVersion,4);
 assert.notEqual(DEPLOYMENT.factory,CURVE_DEPLOYMENT.factory);
});
test('buyback defaults off and survives draft export/import without coercing strings',async()=>{
 const d=newDraft();assert.notEqual(d.autoBuyback,true);
 d.autoBuyback=true;d.creatorFee='1';
 assert.equal((await importDraft(exportDraft(d))).autoBuyback,true);
 assert.equal((await importDraft(exportDraft({...d,autoBuyback:'true'} as any))).autoBuyback,false);
 assert.ok(validateDraft({...d,creatorFee:'0'}).some(x=>x.includes('fund automatic')));
});
test('buyback figures combine curve and pool at one block and reject missing data',async()=>{
 const blocks:bigint[]=[];
 const read:any={getBlockNumber:async()=>123n,readContract:async(r:any)=>{blocks.push(r.blockNumber);if(r.functionName==='autoBuyback')return true;const pool=!!r.args;return r.functionName==='pendingBurnTokens'?7n:r.functionName==='pendingBuybackETH'?(pool?3n:2n):r.functionName==='totalBuybackETH'?(pool?11n:5n):(pool?19n:13n);}};
 const data=await readBuybackStats(read,DEPLOYMENT.factory!,DEPLOYMENT);
 assert.deepEqual(data,{enabled:true,pendingETH:5n,pendingTokens:7n,spentETH:16n,burnedTokens:32n,block:123n});
 assert.ok(blocks.every(x=>x===123n));
 read.readContract=async()=>{throw Error('RPC unavailable');};
 await assert.rejects(readBuybackStats(read,DEPLOYMENT.factory!,DEPLOYMENT),/unavailable/);
});
test('launch-preview sample is a real animated GIF, not draft media',()=>{
 const sampleGifBytes=new Uint8Array(readFileSync('src/assets/buddy/hello.gif'));
 const info=inspectGif(sampleGifBytes);assert.ok(info.frames>=16);assert.ok(info.duration>=350&&info.duration<=450);
 assert.ok(sampleGifBytes.length<1024*1024);assert.deepEqual(newDraft().assets,{});
});
