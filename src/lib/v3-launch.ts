import {bytesToHex,keccak256,parseEther,parseEventLogs,stringToHex,zeroHash,zeroAddress,type Address,type Hex} from 'viem';
import {TOKEN_ABI} from './chain';
import {V3_FACTORY_ABI,V3_LOCKER_ABI,V3_POOL_ABI,V3_BINDING_ABI,V3_CANONICAL} from './v3-contracts';
import {v3LaunchPlan} from './v3-launch-plan';
import {initialBuyFloor,initialPosition} from './v3-math';
import {type Draft,validateDraft} from './assets';
import {reconstructContent,validateMediaBytes} from './inscriptions';
import {readLocal,saveLocal} from './storage';
import {verifyDeployment,inscribeAsset,sendChecked,type Session} from './transactions';
import {launchAttemptSuffix} from './launch-attempt';

const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
const kinds=['image','audio','website'] as const;
function report(s:Session,message:string,hash?:Hex){try{s.onProgress?.({message,hash});}catch{/* UI observers cannot interrupt saved transactions or verification. */}}
type InlineAsset={root:Hex;mimeType:string;encoding:string;data:Hex};

export async function launchV3Draft(s:Session,draft:Draft){
 const issues=validateDraft(draft);if(issues.length)throw new Error(issues.join(' '));
 if(Number(draft.creatorFee||'0')!==0)throw new Error('The new pool has no creator trading fee. Clear the previous fee setting in this draft.');
 for(const asset of Object.values(draft.assets))if(asset){validateMediaBytes(asset);if(keccak256(asset.bytes)!==asset.keccak)throw new Error('Local file bytes changed. Prepare this file again.');}
 const d=await verifyDeployment(s);if(d.kind!=='v3')throw new Error('The immediate-trading release is not deployed. No legacy launch was requested.');
 const initialBuy=parseEther(draft.initialBuy||'0'),minTokensOut=initialBuyFloor(initialBuy),plan=v3LaunchPlan(draft);
 const identity=keccak256(stringToHex(JSON.stringify([draft.name.trim(),draft.symbol.trim(),initialBuy.toString(),...kinds.map(k=>draft.assets[k]?[draft.assets[k]!.mime,draft.assets[k]!.keccak]:null)])));
 const key=(`${d.chainId}:${d.factory}:${s.account}:v3-launch:${identity}`+launchAttemptSuffix(s.launchAttemptId)).toLowerCase();
 let salt=await readLocal<Hex>('carve-v3-salt:'+key);if(!salt){salt=keccak256(stringToHex(crypto.randomUUID()));await saveLocal('carve-v3-salt:'+key,salt);}
 const roots:Hex[]=[zeroHash,zeroHash,zeroHash];
 if(!plan.inline)for(let i=0;i<3;i++){const file=draft.assets[kinds[i]];if(file)roots[i]=await inscribeAsset(s,file);}
 const deadline=BigInt(Math.floor(Date.now()/1000)+1200),value=parseEther('0.0005')+initialBuy;
 const params={name:draft.name.trim(),symbol:draft.symbol.trim(),userSalt:salt,imageRoot:roots[0],audioRoot:roots[1],websiteRoot:roots[2],minTokensOut,sqrtPriceLimitX96:0n,deadline};
 const assetFor=(k:typeof kinds[number]):InlineAsset=>draft.assets[k]?{root:zeroHash,mimeType:draft.assets[k]!.mime,encoding:'identity',data:bytesToHex(draft.assets[k]!.bytes)}:{root:zeroHash,mimeType:'',encoding:'',data:'0x'};
 const assets:[InlineAsset,InlineAsset,InlineAsset]=[assetFor('image'),assetFor('audio'),assetFor('website')];
 report(s,plan.inline?'Review one transaction: all selected media, token, locked pool and initial buy.':'Uploads verified. Review the token and locked-pool launch.');
 // A stable journal key prevents retrying an ambiguous or completed launch, even
 // when preflight data/deadlines differ. The receipt, not a predicted CA, is used.
 const receipt=await sendChecked(s,{address:d.factory,abi:V3_FACTORY_ABI,functionName:plan.inline?'launchWithContent':'launch',args:plan.inline?[params.name,params.symbol,salt,assets,minTokensOut,0n,deadline]:[params],value},key);
 const event=parseEventLogs({abi:V3_FACTORY_ABI,eventName:'Launched',logs:receipt.logs.filter(l=>same(l.address,d.factory))}).find(e=>same(e.args.creator,s.account));
 if(!event)throw new Error('No matching launch event. Do not repeat this transaction; open transaction recovery.');
 const {token,pool,positionId,imageRoot,audioRoot,websiteRoot,initialBuySpent,initialTokensOut}=event.args,recorded=[imageRoot,audioRoot,websiteRoot];
 const blockNumber=receipt.blockNumber;
 const [registered,registeredId,owner,registry,supply,name,symbol,poolFactory,poolFee,token0,token1,lpOwner,locked]=await Promise.all([
  s.read.readContract({address:d.factory,abi:V3_FACTORY_ABI,functionName:'poolForToken',args:[token],blockNumber}),
  s.read.readContract({address:d.factory,abi:V3_FACTORY_ABI,functionName:'positionIdForToken',args:[token],blockNumber}),
  s.read.readContract({address:token,abi:TOKEN_ABI,functionName:'creator',blockNumber}),
  s.read.readContract({address:token,abi:TOKEN_ABI,functionName:'contentRegistry',blockNumber}),
  s.read.readContract({address:token,abi:TOKEN_ABI,functionName:'totalSupply',blockNumber}),
  s.read.readContract({address:token,abi:TOKEN_ABI,functionName:'name',blockNumber}),
  s.read.readContract({address:token,abi:TOKEN_ABI,functionName:'symbol',blockNumber}),
  s.read.readContract({address:pool,abi:V3_POOL_ABI,functionName:'factory',blockNumber}),
  s.read.readContract({address:pool,abi:V3_POOL_ABI,functionName:'fee',blockNumber}),
  s.read.readContract({address:pool,abi:V3_POOL_ABI,functionName:'token0',blockNumber}),
  s.read.readContract({address:pool,abi:V3_POOL_ABI,functionName:'token1',blockNumber}),
  s.read.readContract({address:V3_CANONICAL.manager,abi:V3_BINDING_ABI,functionName:'ownerOf',args:[positionId],blockNumber}),
  s.read.readContract({address:d.engine,abi:V3_LOCKER_ABI,functionName:'positions',args:[token],blockNumber}),
 ]);
 const pair=[token0.toLowerCase(),token1.toLowerCase()];
 if(!same(registered,pool)||registeredId!==positionId||!same(owner,s.account)||!same(registry,d.registry)||supply!==10n**27n||name!==params.name||symbol!==params.symbol
  ||!same(poolFactory,V3_CANONICAL.factory)||poolFee!==10000||!pair.includes(token.toLowerCase())||!pair.includes(V3_CANONICAL.weth.toLowerCase())||!same(lpOwner,d.engine)
  ||!same(locked[0],pool)||locked[1]!==positionId||locked[2]===0n||initialBuySpent>initialBuy||initialTokensOut<minTokensOut)
  throw new Error('Launch bindings did not match. The transaction is mined; do not launch again.');
 const poolLogs=receipt.logs.filter(l=>same(l.address,pool)),managerLogs=receipt.logs.filter(l=>same(l.address,V3_CANONICAL.manager));
 const position=initialPosition(BigInt(token)<BigInt(V3_CANONICAL.weth));
 const initialized=parseEventLogs({abi:V3_POOL_ABI,eventName:'Initialize',logs:poolLogs});
 const minted=parseEventLogs({abi:V3_POOL_ABI,eventName:'Mint',logs:poolLogs}).find(e=>same(e.args.owner,V3_CANONICAL.manager)&&e.args.tickLower===position.lower&&e.args.tickUpper===position.upper&&e.args.amount===position.liquidity);
 const nft=parseEventLogs({abi:V3_BINDING_ABI,eventName:'Transfer',logs:managerLogs}).find(e=>same(e.args.from,zeroAddress)&&same(e.args.to,d.engine)&&e.args.tokenId===positionId);
 const increase=parseEventLogs({abi:V3_BINDING_ABI,eventName:'IncreaseLiquidity',logs:managerLogs}).find(e=>e.args.tokenId===positionId&&e.args.liquidity===position.liquidity);
 if(initialized.length!==1||initialized[0].args.sqrtPriceX96!==position.sqrtPriceX96||!minted||!nft||!increase
  ||minted.args.amount0+minted.args.amount1!==position.tokenDeposited||increase.args.amount0!==minted.args.amount0||increase.args.amount1!==minted.args.amount1)
  throw new Error('Canonical pool initialization and locked-liquidity receipt proof is incomplete. Do not repeat the launch.');
 for(let i=0;i<3;i++){
  const root=await s.read.readContract({address:token,abi:TOKEN_ABI,functionName:(['imageRoot','audioRoot','websiteRoot'] as const)[i],blockNumber});
  const file=draft.assets[kinds[i]];
  if(root!==recorded[i]||(!file&&root!==zeroHash))throw new Error('The token media fields do not match its launch.');
  if(file){const recovered=await reconstructContent(s.read,d.registry,root);if(recovered.hash!==file.keccak||recovered.mime!==file.mime||recovered.encoding!=='identity')throw new Error('Inscribed bytes differ from the reviewed file. Do not repeat this launch.');}
 }
 await saveLocal(`carve-launch-v3:${d.chainId}:${token}`,{token,market:pool,pool,positionId:positionId.toString(),creator:s.account,hash:receipt.transactionHash,image:imageRoot,audio:audioRoot,website:websiteRoot});
 report(s,'Launched: onchain media, public pool and permanent liquidity custody verified.',receipt.transactionHash);
 return {token,market:pool,hash:receipt.transactionHash};
}
