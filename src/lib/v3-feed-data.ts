import {type Address,type PublicClient,type Hex} from 'viem';
import {readLocal,saveLocal} from './storage';
import {V3_POOL_ABI} from './v3-contracts';

/** Share identical pinned reads inside a feed refresh, not across blocks. */
export function sharedReads(client:PublicClient):PublicClient{
 const memo=new Map<string,Promise<unknown>>(),methods=['getCode','getBlock','getStorageAt','getChainId','readContract'] as const;
 const result={...client};for(const method of methods){const fn=client[method] as (...args:any[])=>Promise<unknown>;
  (result as any)[method]=(...args:unknown[])=>{const key=method+JSON.stringify(args,(_k,v)=>typeof v==='bigint'?v.toString()+'n':v);let promise=memo.get(key);if(!promise){promise=fn(...args);memo.set(key,promise);}return promise;};
 }return result;
}
type Volume={version:1;block:string;blockHash:Hex;wei:string;};
const running=new Map<string,Promise<{wei:bigint|null;note:string}>>();
/** Incrementally indexes canonical Swap logs. A partial scan is never shown as total volume. */
export async function v3LifetimeVolume(read:PublicClient,pool:Address,wethIs0:boolean,from:bigint,to:bigint){
 const key='carve-v3-volume:'+pool.toLowerCase();let job=running.get(key);if(job)return job;
 job=(async()=>{let saved:Volume|undefined;try{saved=await readLocal<Volume>(key);}catch{/* Browser storage may be unavailable. */}
  let next=from,total=0n;
  if(saved?.version===1&&BigInt(saved.block)>=from&&BigInt(saved.block)<=to){
   const anchor=await read.getBlock({blockNumber:BigInt(saved.block)});
   if(anchor.hash===saved.blockHash){next=BigInt(saved.block)+1n;total=BigInt(saved.wei);}
  }
  // Bounded work per refresh; continue from the verified checkpoint next time.
  let batches=0;while(next<=to&&batches++<6){const end=next+1999n>to?to:next+1999n,header=await read.getBlock({blockNumber:end});if(!header.hash)throw new Error('Unmined volume anchor');
   const logs=await read.getLogs({address:pool,event:V3_POOL_ABI.find(x=>x.type==='event'&&x.name==='Swap')!,fromBlock:next,toBlock:end,strict:true});
   for(const log of logs){if(log.removed)throw new Error('Reorged volume log');const args=log.args as {amount0?:bigint;amount1?:bigint};const value=wethIs0?args.amount0:args.amount1;if(typeof value!=='bigint')throw new Error('Malformed Swap volume');total+=value<0n?-value:value;}
   const check=await read.request({method:'eth_getBlockByNumber',params:[('0x'+end.toString(16)) as Hex,false]});if(check?.hash!==header.hash)throw new Error('Volume snapshot changed; retry');
   try{await saveLocal(key,{version:1,block:end.toString(),blockHash:header.hash,wei:total.toString()} satisfies Volume);}catch{/* Figures can still be shown from this complete in-memory scan. */}
   next=end+1n;
  }
  return next>to?{wei:total,note:''}:{wei:null,note:'Volume history is indexing; a partial total is not displayed.'};
 })().catch(()=>({wei:null,note:'Volume could not be verified.'})).finally(()=>running.delete(key));running.set(key,job);return job;
}
