import{encodeFunctionData,keccak256,parseEventLogs,toHex,zeroAddress,type Address,type Hex,type PublicClient,type TransactionReceipt}from'viem';
import{ADDRESSES,FACTORY_ABI,LOCKER_ABI,CANONICAL_FACTORY_ABI,NFT_ABI,TOKEN_ABI,POOL_ABI,QUOTER_ABI,ROUTER_ABI,WETH_ABI}from'./v3-trading-abi';
import{checkedAmount,checkedSlippage,fdvWei,initialPosition,minimumOutput,priceLimit,SUPPLY}from'./v3-math';
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
export const WETH_PROXY={implementationSlot:'0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',implementation:'0xC6B81b429797E0f555440b70cD99e032D7AE947e',implementationCodeHash:'0xbe1295f37be34ffe03ad779bda0ef278907e1856b51a3be2f35ee541d75d4650',adminSlot:'0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103',admin:'0xa3Acd31AFb851B4eB9DAD00F5204c01D924267dF',adminCodeHash:'0xa4b2186ab82fa36fb4ae158582e5615ea519e757c26c13ba4a33daaaed8902a7'}as const;
const CANONICAL_HASHES={factory:'0xec72b1abd1f2faee020cfea9c646bd8994f9fb389054f6e574f103a895091739',positionManager:'0x0a493d1af3d0f25fed8efa205244ebee14114267a08647fc38c515c7cd6ead4f',router:'0x6f36c378e272c6324c48f045182bcb54bd8ad654cf9ebd42e8893d52c4cb25dc',quoter:'0x3db0868d945e9304c9bc6a8b2181948109ea617647142f3c4083e14393496a28',weth:'0x5706be52f64875fee65a2cec0d80e47a23d8793cbe85d214b48445e2d05f5353'}as const;
export type Deployment={factory:Address;registry:Address;platformRecipient:Address;factoryCodeHash:Hex;lockerCodeHash:Hex};
export type Snapshot={token:Address;pool:Address;locker:Address;positionId:bigint;tokenIs0:boolean;sqrtPriceX96:bigint;tick:number;liquidity:bigint;initialLiquidity:bigint;tokenPrincipal:bigint;wethPrincipal:bigint;lockedDust:bigint;milestoneReached:boolean;fdvETHWei:bigint;block:bigint;blockHash:Hex;blockTimestamp:bigint};
export type TradeQuote={snapshot:Snapshot;buy:boolean;amountIn:bigint;amountOut:bigint;sqrtPriceAfterX96:bigint;createdAt:number;gasEstimate:bigint};
export type ContractCall={address:Address;abi:readonly unknown[];functionName:string;args:readonly unknown[];value?:bigint};
export type TradePlan={quote:TradeQuote;account:Address;minOut:bigint;sqrtPriceLimitX96:bigint;deadline:bigint;call:ContractCall;outputAsset:Address;outputIsWETH:boolean};
export type Session={read:PublicClient;account:Address;deployment:Deployment;assertCurrent:()=>Promise<void>;sendChecked:(call:ContractCall,key?:string)=>Promise<TransactionReceipt>;now?:()=>number};
async function assertCode(read:PublicClient,address:Address,hash:Hex,blockNumber:bigint){const code=await read.getCode({address,blockNumber});if(!code||!same(keccak256(code),hash))throw Error(`Runtime mismatch: ${address}`);}

async function assertBlockHash(read:PublicClient,block:bigint,hash:Hex){
 // Explicit raw request bypasses ordinary per-block getBlock memoization on a shared polling reader.
 const latest=await read.request({method:'eth_getBlockByNumber',params:[toHex(block),false]});
 if(!latest?.hash||!same(latest.hash,hash))throw Error('Block reorganized during verification; refresh');
}
/** Token-independent release/prelaunch check. No caching across blocks; caller may share a per-poll memoized reader. */
export async function verifyCanonical(read:PublicClient,blockNumber?:bigint){
 if(await read.getChainId()!==ADDRESSES.chainId)throw Error('Wrong chain');
 const block=blockNumber??await read.getBlockNumber({cacheTime:0}),header=await read.getBlock({blockNumber:block});if(!header.hash)throw Error('Unmined block');
 await Promise.all(Object.entries(CANONICAL_HASHES).map(([key,hash])=>assertCode(read,ADDRESSES[key as keyof typeof CANONICAL_HASHES],hash,block)));
 const [implementation,admin]=await Promise.all([read.getStorageAt({address:ADDRESSES.weth,slot:WETH_PROXY.implementationSlot,blockNumber:block}),read.getStorageAt({address:ADDRESSES.weth,slot:WETH_PROXY.adminSlot,blockNumber:block})]);
 if(!implementation||!admin||!same('0x'+implementation.slice(-40),WETH_PROXY.implementation)||!same('0x'+admin.slice(-40),WETH_PROXY.admin))throw Error('WETH proxy upgrade detected; deployment review required');
 await Promise.all([assertCode(read,WETH_PROXY.implementation,WETH_PROXY.implementationCodeHash,block),assertCode(read,WETH_PROXY.admin,WETH_PROXY.adminCodeHash,block)]);
 await assertBlockHash(read,block,header.hash);
 return{block,blockHash:header.hash,blockTimestamp:header.timestamp};
}

/** All reads are pinned to one block; requires independently verified candidate runtime hashes. */
export async function readMarket(read:PublicClient,token:Address,d:Deployment,blockNumber?:bigint):Promise<Snapshot>{
 const verified=await verifyCanonical(read,blockNumber),block=verified.block;
 await assertCode(read,d.factory,d.factoryCodeHash,block);
 const args={address:d.factory,abi:FACTORY_ABI,blockNumber:block};
 const [pool,locker,positionId,registry,platform]=await Promise.all([read.readContract({...args,functionName:'poolForToken',args:[token]}),read.readContract({...args,functionName:'locker'}),read.readContract({...args,functionName:'positionIdForToken',args:[token]}),read.readContract({...args,functionName:'registry'}),read.readContract({...args,functionName:'platformRecipient'})]);
 if(same(pool,zeroAddress)||same(locker,zeroAddress)||!same(registry,d.registry)||!same(platform,d.platformRecipient))throw Error('Factory deployment/token binding mismatch');
 await assertCode(read,locker,d.lockerCodeHash,block);
 const poolArgs={address:pool,abi:POOL_ABI,blockNumber:block},lockerArgs={address:locker,abi:LOCKER_ABI,blockNumber:block};
 const [canonicalPool,poolFactory,token0,token1,fee,spacing,slot,liquidity,locked,principal,lockerFactory,lockerPlatform,nftOwner,nftApproval,nftPosition,supply,decimals,tokenRegistry]=await Promise.all([
  read.readContract({address:ADDRESSES.factory,abi:CANONICAL_FACTORY_ABI,functionName:'getPool',args:[token,ADDRESSES.weth,10000],blockNumber:block}),
  read.readContract({...poolArgs,functionName:'factory'}),read.readContract({...poolArgs,functionName:'token0'}),read.readContract({...poolArgs,functionName:'token1'}),read.readContract({...poolArgs,functionName:'fee'}),read.readContract({...poolArgs,functionName:'tickSpacing'}),read.readContract({...poolArgs,functionName:'slot0'}),read.readContract({...poolArgs,functionName:'liquidity'}),
  read.readContract({...lockerArgs,functionName:'positions',args:[token]}),read.readContract({...lockerArgs,functionName:'principal',args:[token]}),read.readContract({...lockerArgs,functionName:'launchFactory'}),read.readContract({...lockerArgs,functionName:'platformRecipient'}),
  read.readContract({address:ADDRESSES.positionManager,abi:NFT_ABI,functionName:'ownerOf',args:[positionId],blockNumber:block}),read.readContract({address:ADDRESSES.positionManager,abi:NFT_ABI,functionName:'getApproved',args:[positionId],blockNumber:block}),read.readContract({address:ADDRESSES.positionManager,abi:NFT_ABI,functionName:'positions',args:[positionId],blockNumber:block}),
  read.readContract({address:token,abi:TOKEN_ABI,functionName:'totalSupply',blockNumber:block}),read.readContract({address:token,abi:TOKEN_ABI,functionName:'decimals',blockNumber:block}),read.readContract({address:token,abi:TOKEN_ABI,functionName:'contentRegistry',blockNumber:block})]);
 const tokenIs0=BigInt(token)<BigInt(ADDRESSES.weth),p=initialPosition(tokenIs0);
 if(!same(canonicalPool,pool)||!same(poolFactory,ADDRESSES.factory)||!same(token0,tokenIs0?token:ADDRESSES.weth)||!same(token1,tokenIs0?ADDRESSES.weth:token)||fee!==10000||spacing!==200||slot[0]===0n||!slot[6])throw Error('Canonical pool binding mismatch');
 if(!same(lockerFactory,d.factory)||!same(lockerPlatform,d.platformRecipient)||!same(nftOwner,locker)||!same(nftApproval,zeroAddress)||!same(nftPosition[1],zeroAddress)||!same(nftPosition[2],token0)||!same(nftPosition[3],token1)||nftPosition[4]!==10000||nftPosition[5]!==p.lower||nftPosition[6]!==p.upper||nftPosition[7]<p.liquidity||!same(locked[0],pool)||locked[1]!==positionId||locked[2]!==p.liquidity||locked[3]!==p.lower||locked[4]!==p.upper||locked[5]!==SUPPLY-p.tokenDeposited||principal[2]!==locked[5]||principal[3]!== (principal[1]>=4200000000000000000n))throw Error('Locked position binding mismatch');
 if(supply!==SUPPLY||decimals!==18||!same(tokenRegistry,d.registry))throw Error('Token metadata/supply binding mismatch');
 await assertBlockHash(read,block,verified.blockHash);
 return{token,pool,locker,positionId,tokenIs0,sqrtPriceX96:slot[0],tick:slot[1],liquidity,initialLiquidity:locked[2],tokenPrincipal:principal[0],wethPrincipal:principal[1],lockedDust:principal[2],milestoneReached:principal[3],fdvETHWei:fdvWei(supply,slot[0],tokenIs0),...verified};
}

export async function quoteTrade(read:PublicClient,token:Address,buy:boolean,amountIn:bigint,d:Deployment,now=Date.now()):Promise<TradeQuote>{
 checkedAmount(amountIn);const snapshot=await readMarket(read,token,d);const q=await read.simulateContract({address:ADDRESSES.quoter,abi:QUOTER_ABI,functionName:'quoteExactInputSingle',args:[{tokenIn:buy?ADDRESSES.weth:token,tokenOut:buy?token:ADDRESSES.weth,amountIn,fee:10000,sqrtPriceLimitX96:0n}],blockNumber:snapshot.block});
 if(q.result[0]<=0n)throw Error('Trade produces zero output');await assertBlockHash(read,snapshot.block,snapshot.blockHash);return{snapshot,buy,amountIn,amountOut:q.result[0],sqrtPriceAfterX96:q.result[1],gasEstimate:q.result[3],createdAt:now};
}
export function prepareTrade(quote:TradeQuote,account:Address,slippageBps:number,deadline:bigint):TradePlan{
 checkedAmount(quote.amountIn);checkedSlippage(slippageBps);if(same(account,zeroAddress)||same(account,ADDRESSES.router)||deadline<=quote.snapshot.blockTimestamp)throw Error('Invalid recipient/deadline');
 const minOut=minimumOutput(quote.amountOut,slippageBps),zeroForOne=quote.buy?!quote.snapshot.tokenIs0:quote.snapshot.tokenIs0;
 const sqrtPriceLimitX96=priceLimit(quote.snapshot.sqrtPriceX96,quote.sqrtPriceAfterX96,zeroForOne,slippageBps);
 const swap=encodeFunctionData({abi:ROUTER_ABI,functionName:'exactInputSingle',args:[{tokenIn:quote.buy?ADDRESSES.weth:quote.snapshot.token,tokenOut:quote.buy?quote.snapshot.token:ADDRESSES.weth,fee:10000,recipient:account,amountIn:quote.amountIn,amountOutMinimum:minOut,sqrtPriceLimitX96}]});
 const data=quote.buy?[swap,encodeFunctionData({abi:ROUTER_ABI,functionName:'refundETH'})]:[swap];
 return{quote,account,minOut,sqrtPriceLimitX96,deadline,outputAsset:quote.buy?quote.snapshot.token:ADDRESSES.weth,outputIsWETH:!quote.buy,call:{address:ADDRESSES.router,abi:ROUTER_ABI,functionName:'multicall',args:[deadline,data],value:quote.buy?quote.amountIn:0n}};
}
export function verifyTradeReceipt(plan:TradePlan,receipt:TransactionReceipt){
 if(receipt.status!=='success')throw Error('Trade reverted');
 const logs=receipt.logs.filter(l=>same(l.address,plan.quote.snapshot.pool));const events=parseEventLogs({abi:POOL_ABI,eventName:'Swap',logs,strict:true});
 if(events.length!==1||!same(events[0].args.sender,ADDRESSES.router)||!same(events[0].args.recipient,plan.account))throw Error('Unexpected swap receipt');
 const a=events[0].args;const tokenDelta=plan.quote.snapshot.tokenIs0?a.amount0:a.amount1,wethDelta=plan.quote.snapshot.tokenIs0?a.amount1:a.amount0;
 const spent=plan.quote.buy?wethDelta:tokenDelta,out=-(plan.quote.buy?tokenDelta:wethDelta);
 if(spent<=0n||spent>plan.quote.amountIn||out<plan.minOut)throw Error('Receipt amount/slippage mismatch');
 const transfers=parseEventLogs({abi:TOKEN_ABI,eventName:'Transfer',logs:receipt.logs.filter(l=>same(l.address,plan.outputAsset)),strict:true});
 const received=transfers.filter(l=>same(l.args.from,plan.quote.snapshot.pool)&&same(l.args.to,plan.account)).reduce((n,l)=>n+l.args.value,0n);
 if(received!==out)throw Error('Output transfer mismatch');
 return{amountInSpent:spent,amountOut:out,unspentInput:plan.quote.amountIn-spent,outputAsset:plan.outputAsset,transactionHash:receipt.transactionHash};
}
function fresh(q:TradeQuote,now:number){if(now<q.createdAt||now-q.createdAt>60000)throw Error('Quote expired; refresh before trading');}
/** sendChecked must simulate, persist intent, bind account+chain, and verify the winning mined transaction. */
export async function executeTrade(session:Session,quote:TradeQuote,slippageBps:number){
 checkedSlippage(slippageBps);checkedAmount(quote.amountIn);minimumOutput(quote.amountOut,slippageBps);
 const now=session.now??Date.now;await session.assertCurrent();fresh(quote,now());
 const check=async()=>{await session.assertCurrent();fresh(quote,now());const state=await readMarket(session.read,quote.snapshot.token,session.deployment);if(!same(state.pool,quote.snapshot.pool)||!same(state.locker,quote.snapshot.locker)||state.positionId!==quote.snapshot.positionId)throw Error('Market binding changed');if(quote.buy&&(await session.read.getBalance({address:ADDRESSES.router}))!==0n)throw Error('Router has existing public ETH dust; retry later');};
 await check();
 if(!quote.buy){const allowance=await session.read.readContract({address:quote.snapshot.token,abi:TOKEN_ABI,functionName:'allowance',args:[session.account,ADDRESSES.router]});if(allowance<quote.amountIn)await session.sendChecked({address:quote.snapshot.token,abi:TOKEN_ABI,functionName:'approve',args:[ADDRESSES.router,quote.amountIn]});}
 await check();const plan=prepareTrade(quote,session.account,slippageBps,BigInt(Math.floor(now()/1000)+300));
 const receipt=await session.sendChecked(plan.call);return verifyTradeReceipt(plan,receipt);
}
/** Separate wallet-owned WETH withdrawal: exact amount, no router balance sweep. */
export function prepareWethWithdrawal(amount:bigint):ContractCall{return{address:ADDRESSES.weth,abi:WETH_ABI,functionName:'withdraw',args:[checkedAmount(amount)],value:0n};}
