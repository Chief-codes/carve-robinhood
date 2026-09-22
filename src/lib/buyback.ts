import {type Address,type PublicClient} from 'viem';
import {type Deployment} from './chain';
import {AUTO_MARKET_ABI,AUTO_ENGINE_ABI} from './curve-contracts';
export type BuybackSnapshot={enabled:boolean;pendingETH:bigint;pendingTokens:bigint;spentETH:bigint;burnedTokens:bigint;block:bigint};
/** Read both phases at the same block; transferred budgets are not counted twice. */
export async function readBuybackStats(read:PublicClient,market:Address,d:Deployment):Promise<BuybackSnapshot>{
 if(d.curveVersion!==5||!d.engine)throw new Error('Not a buyback release.');
 const block=await read.getBlockNumber();
 const enabled=await read.readContract({address:market,abi:AUTO_MARKET_ABI,functionName:'autoBuyback',blockNumber:block});
 if(!enabled)return {enabled,pendingETH:0n,pendingTokens:0n,spentETH:0n,burnedTokens:0n,block};
 const [curvePending,curveSpent,curveBurned,poolPending,poolSpent,poolBurned,pendingTokens]=await Promise.all([
  read.readContract({address:market,abi:AUTO_MARKET_ABI,functionName:'pendingBuybackETH',blockNumber:block}),
  read.readContract({address:market,abi:AUTO_MARKET_ABI,functionName:'totalBuybackETH',blockNumber:block}),
  read.readContract({address:market,abi:AUTO_MARKET_ABI,functionName:'totalTokensBurned',blockNumber:block}),
  read.readContract({address:d.engine,abi:AUTO_ENGINE_ABI,functionName:'pendingBuybackETH',args:[market],blockNumber:block}),
  read.readContract({address:d.engine,abi:AUTO_ENGINE_ABI,functionName:'totalBuybackETH',args:[market],blockNumber:block}),
  read.readContract({address:d.engine,abi:AUTO_ENGINE_ABI,functionName:'totalTokensBurned',args:[market],blockNumber:block}),
  read.readContract({address:d.engine,abi:AUTO_ENGINE_ABI,functionName:'pendingBurnTokens',args:[market],blockNumber:block})
 ]);
 return {enabled,pendingETH:curvePending+poolPending,spentETH:curveSpent+poolSpent,burnedTokens:curveBurned+poolBurned,pendingTokens,block};
}
