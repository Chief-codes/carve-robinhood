import {parseAbi,parseEther,zeroAddress,type Address,type PublicClient} from 'viem';
import {DEPLOYMENT,FACTORY_ABI,MARKET_ABI,TOKEN_ABI,ROUTER_ABI,type Deployment} from './chain';
import {assertSession,sendChecked,withMigrationHeadroom,type Session} from './transactions';

const QUOTER='0x8dc178efb8111bb0973dd9d722ebeff267c98f94' as Address;
const QUOTER_ABI=parseAbi(['function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)']);
export type TradeQuote={token:Address;market:Address;phase:number;buy:boolean;amountIn:bigint;amountOut:bigint;refund:bigint;timestamp:number;block:bigint;};
export async function findMarket(read:PublicClient,token:Address,d=DEPLOYMENT){
 if(!d.factory)return null;
 const market=await read.readContract({address:d.factory,abi:FACTORY_ABI,functionName:'marketForToken',args:[token]});
 if(market===zeroAddress)return null;
 if((await read.readContract({address:market,abi:MARKET_ABI,functionName:'token'})).toLowerCase()!==token.toLowerCase())throw new Error('Market binding mismatch.');
 return market;
}
export async function quoteTrade(read:PublicClient,token:Address,buy:boolean,amountIn:bigint,d:Deployment=DEPLOYMENT):Promise<TradeQuote>{
 if(amountIn<=0n||amountIn>(1n<<127n)-1n)throw new Error('Enter a supported positive amount.');
 const market=await findMarket(read,token,d);if(!market)throw new Error('This token was not launched by the configured Carve factory.');
 const phase=await read.readContract({address:market,abi:MARKET_ABI,functionName:'phase'});
 let amountOut:bigint,refund=0n;
 if(phase===0){
  if(buy){const q=await read.readContract({address:market,abi:MARKET_ABI,functionName:'quoteBuy',args:[amountIn]});amountOut=q[0];refund=q[4];}
  else{const q=await read.readContract({address:market,abi:MARKET_ABI,functionName:'quoteSell',args:[amountIn]});amountOut=q[0];}
 }else if(phase===2&&d.engine){
  // eth_call executes and reverts the internal swap. This requests no approval or real transaction.
  const q=await read.simulateContract({address:QUOTER,abi:QUOTER_ABI,functionName:'quoteExactInputSingle',args:[{poolKey:{currency0:zeroAddress,currency1:token,fee:0,tickSpacing:200,hooks:d.engine},zeroForOne:buy,exactAmount:amountIn,hookData:'0x'}]});
  amountOut=q.result[0];
 }else throw new Error('This market is transitioning. Refresh shortly.');
 if(amountOut===0n)throw new Error('This amount produces no output. Choose another amount.');
 return {token,market,phase,buy,amountIn,amountOut,refund,timestamp:Date.now(),block:await read.getBlockNumber()};
}
export async function executeTrade(s:Session,quote:TradeQuote,slippageBps:number){
 const d=await assertSession(s);
 if(Date.now()-quote.timestamp>60000)throw new Error('Quote expired. Get a fresh quote before trading.');
 if(!Number.isInteger(slippageBps)||slippageBps<0||slippageBps>500)throw new Error('Slippage must be between 0% and 5%.');
 const minOut=quote.amountOut*BigInt(10000-slippageBps)/10000n;
 if(minOut===0n)throw new Error('Minimum output must be greater than zero.');
 const spender=quote.phase===0?quote.market:d.router;
 if((await findMarket(s.read,quote.token,d))?.toLowerCase()!==quote.market.toLowerCase())throw new Error('Market binding changed.');
 if(!quote.buy){
  const allowance=await s.read.readContract({address:quote.token,abi:TOKEN_ABI,functionName:'allowance',args:[s.account,spender]});
  if(allowance<quote.amountIn)await sendChecked(s,{address:quote.token,abi:TOKEN_ABI,functionName:'approve',args:[spender,quote.amountIn]});
 }
 if(Date.now()-quote.timestamp>60000)throw new Error('Quote expired while waiting for approval. Get a fresh quote; your token approval is already saved onchain.');
 if(await s.read.readContract({address:quote.market,abi:MARKET_ABI,functionName:'phase'})!==quote.phase)throw new Error('The token graduated since this quote. Refresh and review the new route.');
 const deadline=BigInt(Math.floor(Date.now()/1000)+300);
 if(quote.phase===0){
  const call={address:quote.market,abi:MARKET_ABI,functionName:quote.buy?'buy':'sell',args:quote.buy?[minOut,deadline]:[quote.amountIn,minOut,deadline],value:quote.buy?quote.amountIn:0n};
  if(quote.buy&&d.curveVersion===4){
   const [reserve,currentQuote]=await Promise.all([s.read.readContract({address:quote.market,abi:MARKET_ABI,functionName:'reserveETH'}),s.read.readContract({address:quote.market,abi:MARKET_ABI,functionName:'quoteBuy',args:[quote.amountIn]})]);
   if(reserve+currentQuote[1]-currentQuote[2]-currentQuote[3]>=parseEther('4.2'))return sendChecked(s,await withMigrationHeadroom(s,call));
  }
  return sendChecked(s,call);
 }
 return sendChecked(s,{address:d.router,abi:ROUTER_ABI,functionName:'swapExactInput',args:[quote.token,quote.buy,quote.amountIn,minOut,0n,deadline],value:quote.buy?quote.amountIn:0n});
}
