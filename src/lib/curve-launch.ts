import {bytesToHex,keccak256,parseEther,parseEventLogs,stringToHex,zeroHash,type Hex} from 'viem';
import {TOKEN_ABI,MARKET_ABI} from './chain';
import {CURVE_FACTORY_ABI,CURVE_ENGINE_ABI} from './curve-contracts';
import {v3LaunchPlan} from './v3-launch-plan';
import {validateDraft,type Draft} from './assets';
import {reconstructContent,validateMediaBytes} from './inscriptions';
import {saveLocal} from './storage';
import {verifyDeployment,inscribeAsset,sendChecked,withMigrationHeadroom,creatorBasisPoints,type Session} from './transactions';
import {launchAttemptSuffix} from './launch-attempt';
const kinds=['image','audio','website'] as const;
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();

/** The amount is chosen by each creator; the test wallet's 0.01 ETH is not a protocol default. */
export function curveInitialMinimum(initialBuy:bigint,creatorBps:number){
 if(initialBuy<0n||!Number.isInteger(creatorBps)||creatorBps<0||creatorBps>1000)throw new Error('Invalid launch amount or creator fee.');
 const net=initialBuy*BigInt(9900-creatorBps)/10000n;
 const accepted=net>parseEther('4.2')?parseEther('4.2'):net;
 return 10n**27n*accepted/(parseEther('1.68')+accepted);
}

export async function launchCurveDraft(s:Session,draft:Draft){
 const issues=validateDraft(draft);if(issues.length)throw new Error(issues.join(' '));
 for(const asset of Object.values(draft.assets))if(asset){validateMediaBytes(asset);if(keccak256(asset.bytes)!==asset.keccak)throw new Error('Local file integrity failed.');}
 const d=await verifyDeployment(s);if(d.curveVersion!==4)throw new Error('The new curve release has not been verified.');
 const initialBuy=parseEther(draft.initialBuy||'0'),bps=creatorBasisPoints(draft),minOut=curveInitialMinimum(initialBuy,bps),plan=v3LaunchPlan(draft);
 const roots:Hex[]=[zeroHash,zeroHash,zeroHash];
 if(!plan.inline)for(let i=0;i<3;i++){const asset=draft.assets[kinds[i]];if(asset)roots[i]=await inscribeAsset(s,asset);}
 const identity=keccak256(stringToHex(JSON.stringify([draft.name.trim(),draft.symbol.trim(),bps,initialBuy.toString(),...kinds.map(k=>draft.assets[k]?[draft.assets[k]!.mime,draft.assets[k]!.keccak]:null)])));
 const key=(`${d.chainId}:${d.factory}:${s.account}:curve-launch:${identity}`+launchAttemptSuffix(s.launchAttemptId)).toLowerCase();
 const deadline=BigInt(Math.floor(Date.now()/1000)+1200);
 const assets=kinds.map(k=>draft.assets[k]?{root:zeroHash,mimeType:draft.assets[k]!.mime,encoding:'identity',data:bytesToHex(draft.assets[k]!.bytes)}:{root:zeroHash,mimeType:'',encoding:'',data:'0x'});
 const call={address:d.factory,abi:CURVE_FACTORY_ABI,functionName:plan.inline?'launchInline':'launch',
  args:plan.inline?[draft.name.trim(),draft.symbol.trim(),assets,bps,minOut,deadline]:[draft.name.trim(),draft.symbol.trim(),...roots,bps,minOut,deadline],value:parseEther('0.0005')+initialBuy};
 const hitsCap=initialBuy*BigInt(9900-bps)/10000n>=parseEther('4.2');
 const receipt=await sendChecked(s,hitsCap?await withMigrationHeadroom(s,call):call,key);
 const event=parseEventLogs({abi:CURVE_FACTORY_ABI,eventName:'Launched',logs:receipt.logs.filter(l=>same(l.address,d.factory))}).find(e=>same(e.args.creator,s.account));
 if(!event)throw new Error('No matching launch receipt. The request may already be mined; do not repeat it.');
 const {token,market,imageRoot,audioRoot,websiteRoot,creatorFeeBps}=event.args,recorded=[imageRoot,audioRoot,websiteRoot],blockNumber=receipt.blockNumber;
 const [registered,marketToken,creator,registry,supply,name,symbol,phase]=await Promise.all([
  s.read.readContract({address:d.factory,abi:CURVE_FACTORY_ABI,functionName:'marketForToken',args:[token],blockNumber}),
  s.read.readContract({address:market,abi:MARKET_ABI,functionName:'token',blockNumber}),
  s.read.readContract({address:token,abi:TOKEN_ABI,functionName:'creator',blockNumber}),
  s.read.readContract({address:token,abi:TOKEN_ABI,functionName:'contentRegistry',blockNumber}),
  s.read.readContract({address:token,abi:TOKEN_ABI,functionName:'totalSupply',blockNumber}),
  s.read.readContract({address:token,abi:TOKEN_ABI,functionName:'name',blockNumber}),
  s.read.readContract({address:token,abi:TOKEN_ABI,functionName:'symbol',blockNumber}),
  s.read.readContract({address:market,abi:MARKET_ABI,functionName:'phase',blockNumber}),
 ]);
 if(!same(registered,market)||!same(marketToken,token)||!same(creator,s.account)||!same(registry,d.registry)||supply!==10n**27n||name!==draft.name.trim()||symbol!==draft.symbol.trim()||creatorFeeBps!==bps)throw new Error('Mined launch bindings differ from the reviewed request. Do not repeat it.');
 for(let i=0;i<3;i++){
  const root=await s.read.readContract({address:token,abi:TOKEN_ABI,functionName:(['imageRoot','audioRoot','websiteRoot'] as const)[i],blockNumber});
  const asset=draft.assets[kinds[i]];
  if(root!==recorded[i]||(!asset&&root!==zeroHash))throw new Error('Mined media root mismatch.');
  if(asset){const restored=await reconstructContent(s.read,d.registry,root);if(restored.hash!==asset.keccak||restored.mime!==asset.mime||restored.encoding!=='identity')throw new Error('Mined inscription does not match the reviewed bytes.');}
 }
 if(phase===2&&!await s.read.readContract({address:d.engine,abi:CURVE_ENGINE_ABI,functionName:'verifyPosition',args:[market],blockNumber}))throw new Error('Graduated position verification failed. Do not relaunch.');
 await saveLocal(`carve-launch-curve:${d.chainId}:${token}`,{token,market,creator:s.account,hash:receipt.transactionHash,image:imageRoot,audio:audioRoot,website:websiteRoot});
 try{s.onProgress?.({message:'Token launched. All selected media and launch bindings verified.',hash:receipt.transactionHash});}catch{}
 return {token,market,hash:receipt.transactionHash};
}
