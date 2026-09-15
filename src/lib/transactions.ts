import {encodeFunctionData,parseEventLogs,parseEther,parseUnits,keccak256,stringToHex,bytesToHex,zeroAddress,zeroHash,
 type Abi,type Address,type Hex,type PublicClient,type WalletClient,type TransactionReceipt} from 'viem';
import {DEPLOYMENT,REGISTRY_ABI,FACTORY_ABI,TOKEN_ABI,ENGINE_ABI,ROUTER_ABI,type Deployment} from './chain';
import {splitChunks,validateDraft,type Draft,type ContentAsset} from './assets';
import {contentRoot,readPointer,reconstructContent,validateMediaBytes} from './inscriptions';
import {readLocal,saveLocal,listLocal} from './storage';
import {verifyV3Release} from './v3-release';
import {checkRejectedRequest} from './rejected-request';
import {CURVE_FACTORY_ABI,CURVE_ENGINE_ABI,CURVE_POSITION_MANAGER,CURVE_POSITION_MANAGER_HASH} from './curve-contracts';

export type Progress={message:string;hash?:Hex;completed?:number;total?:number;};
export type Session={read:PublicClient;wallet:WalletClient;account:Address;isCurrent:()=>boolean;deployment?:Deployment;launchAttemptId?:string;onProgress?:(p:Progress)=>void;};
type Call={address:Address;abi:Abi;functionName:string;args?:readonly unknown[];value?:bigint;gas?:bigint;};
// A soft-failing migration can make eth_estimateGas accept the cheaper deferred path.
// Give cap-crossing calls explicit headroom; unused gas is not charged.
export async function withMigrationHeadroom(s:Session,call:Call):Promise<Call>{
 const estimate=await s.read.estimateContractGas({...call,account:s.account});
 const gas=estimate+3_000_000n;
 const block=await s.read.getBlock();
 if(gas>30_000_000n||gas>block.gasLimit)throw new Error('This cap-crossing request needs more gas than the supported transaction budget. Reduce media size or complete migration separately.');
 return {...call,gas};
}
export type Journal={version:1;account:Address;chainId:number;to:Address;data:Hex;value:string;nonce?:number;label?:string;createdAt?:number;hash?:Hex;state:'awaiting-wallet'|'submitted'|'confirmed'|'rejected'|'reverted'|'replaced';};
const journalPrefix='carve-tx-v2:';
function explicitlyRejected(error:unknown){let current=error;const seen=new Set<unknown>();for(let i=0;i<8&&current&&typeof current==='object'&&!seen.has(current);i++){seen.add(current);if((current as {code?:unknown}).code===4001)return true;current=(current as {cause?:unknown}).cause;}return false;}
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
function report(s:Session,p:Progress){try{s.onProgress?.(p);}catch{/* UI observers must never interrupt transaction persistence or verification. */}}

export async function transactionHistory(account:Address,chainId:number){return (await listLocal<Journal>(journalPrefix)).filter(x=>x.value.chainId===chainId&&same(x.value.account,account)).map(x=>({...x.value,key:x.key.slice(journalPrefix.length)})).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));}
export function creatorBasisPoints(d:Draft){return Number(parseUnits(d.creatorFee||'0',2));}
export async function assertSession(s:Session){
 const d=s.deployment||DEPLOYMENT;
 if(!d.launchEnabled||d.status!=='verified'||!d.registry||!d.factory||!d.engine||!d.router)throw new Error('Mainnet deployment has not been verified. No transaction was requested.');
 if(!s.isCurrent())throw new Error('Wallet changed. Reopen the action with your current wallet.');
 const [chain,accounts,rpcChain]=await Promise.all([s.wallet.getChainId(),s.wallet.getAddresses(),s.read.getChainId()]);
 if(chain!==d.chainId||rpcChain!==d.chainId)throw new Error('Switch your selected wallet to Robinhood Chain.');
 if(!accounts[0]||!same(accounts[0],s.account)||!s.isCurrent())throw new Error('Wallet account changed. Please review again.');
 return d as Deployment & {registry:Address;factory:Address;engine:Address;router:Address};
}
export async function verifyDeployment(s:Session){
 const d=await assertSession(s);
 if(d.kind==='v3')return verifyV3Release(s.read,d);
 const code=await Promise.all([d.registry,d.factory,d.engine,d.router].map(address=>s.read.getCode({address})));
 if(code.some(c=>!c||c==='0x'))throw new Error('A configured contract is missing. Transactions are disabled.');
 if(d.curveVersion===4){
  for(const [i,key] of (['registry','factory','engine','router'] as const).entries())if(!d.codeHashes?.[key]||keccak256(code[i]!)!==d.codeHashes[key])throw new Error('Replacement runtime differs from the verified release.');
  const [version,limit,manager,managerCode]=await Promise.all([
   s.read.readContract({address:d.factory,abi:CURVE_FACTORY_ABI,functionName:'version'}),
   s.read.readContract({address:d.factory,abi:CURVE_FACTORY_ABI,functionName:'maxInlineBytes'}),
   s.read.readContract({address:d.engine,abi:CURVE_ENGINE_ABI,functionName:'POSITION_MANAGER'}),
   s.read.getCode({address:CURVE_POSITION_MANAGER}),
  ]);
  if(version!==4n||limit!==24576n||!same(manager,CURVE_POSITION_MANAGER)||!managerCode||keccak256(managerCode)!==CURVE_POSITION_MANAGER_HASH)throw new Error('Replacement canonical position-manager verification failed.');
 }
 const [registry,engine,factory,routerEngine,fee,supply,virtual,cap,maxCreator]=await Promise.all([
  s.read.readContract({address:d.factory,abi:FACTORY_ABI,functionName:'registry'}),
  s.read.readContract({address:d.factory,abi:FACTORY_ABI,functionName:'migrationAdapter'}),
  s.read.readContract({address:d.engine,abi:ENGINE_ABI,functionName:'factory'}),
  s.read.readContract({address:d.router,abi:ROUTER_ABI,functionName:'engine'}),
  s.read.readContract({address:d.factory,abi:FACTORY_ABI,functionName:'creationFee'}),
  s.read.readContract({address:d.factory,abi:FACTORY_ABI,functionName:'supply'}),
  s.read.readContract({address:d.factory,abi:FACTORY_ABI,functionName:'virtualETH'}),
  s.read.readContract({address:d.factory,abi:FACTORY_ABI,functionName:'capETH'}),
  s.read.readContract({address:d.factory,abi:FACTORY_ABI,functionName:'creatorFeeLimitBps'})
 ]);
 if(!same(registry,d.registry)||!same(engine,d.engine)||!same(factory,d.factory)||!same(routerEngine,d.engine)
  ||fee!==parseEther('0.0005')||supply!==10n**27n||virtual!==parseEther('1.68')||cap!==parseEther('4.2')||maxCreator!==1000)
  throw new Error('Deployment parameters do not match the approved release.');
 return d;
}

async function confirmJournal(s:Session,key:string,j:Journal):Promise<TransactionReceipt>{
 await assertSession(s);
 if(!same(j.account,s.account)||j.chainId!==(s.deployment||DEPLOYMENT).chainId)throw new Error('Saved transaction belongs to another account or network.');
 if(!j.hash)throw new Error('An earlier wallet request has no confirmed transaction hash. Check wallet Activity before retrying; do not launch twice.');
 report(s,{message:'Waiting for chain confirmation…',hash:j.hash});
 const receipt=await s.read.waitForTransactionReceipt({hash:j.hash,confirmations:1,timeout:180000});
 const tx=await s.read.getTransaction({hash:receipt.transactionHash});
 if(!tx.to||!same(tx.to,j.to)||!same(tx.from,j.account)||tx.input!==j.data||tx.value!==BigInt(j.value)||(j.nonce!==undefined&&tx.nonce!==j.nonce))
  throw new Error('The transaction was replaced or changed. Check wallet Activity; no follow-up transaction was sent.');
 if(receipt.status!=='success'){
  await saveLocal(journalPrefix+key,{...j,state:'reverted'});throw new Error('The transaction reverted. Nothing in this transaction was applied.');
 }
 await saveLocal(journalPrefix+key,{...j,hash:receipt.transactionHash,state:'confirmed'});
 return receipt;
}

export async function recoverTransaction(s:Session,key:string,hash:Hex){
 const d=await assertSession(s),j=await readLocal<Journal>(journalPrefix+key);
 if(!j||j.chainId!==d.chainId||!same(j.account,s.account))throw new Error('No matching saved request for this wallet.');
 const candidate=await s.read.getTransaction({hash});
 const validSender=(tx:typeof candidate)=>same(tx.from,j.account)&&(j.nonce===undefined||tx.nonce===j.nonce);
 const matches=(tx:typeof candidate)=>!!tx.to&&same(tx.to,j.to)&&tx.input===j.data&&tx.value===BigInt(j.value);
 if(!validSender(candidate))throw new Error('This hash belongs to a different wallet request.');
 if(j.nonce===undefined&&!matches(candidate))throw new Error('This older request needs its original transaction hash.');
 // A replacement race can make waitForTransactionReceipt return a DIFFERENT winning hash.
 const receipt=await s.read.waitForTransactionReceipt({hash,confirmations:1,timeout:180000});
 const mined=await s.read.getTransaction({hash:receipt.transactionHash});
 if(!validSender(mined))throw new Error('Confirmed transaction does not match the saved account and nonce.');
 if(!matches(mined)){
  if(j.nonce===undefined)throw new Error('Cannot prove this older request was replaced.');
  await saveLocal(journalPrefix+key,{...j,hash:receipt.transactionHash,state:'replaced'});
  return 'A confirmed replacement used this nonce. The original request cannot execute. Review your intended action again.';
 }
 const recovered:Journal={...j,hash:receipt.transactionHash,state:'submitted'};
 await saveLocal(journalPrefix+key,recovered);
 await confirmJournal(s,key,recovered);
 return 'Transaction confirmed and verified. Resume your launch to continue without repeating this transaction.';
}

async function sendUnlocked(s:Session,call:Call,key?:string):Promise<TransactionReceipt>{
 const d=await assertSession(s);
 let journalKey=(key||`${d.chainId}:${s.account}:${crypto.randomUUID()}`).toLowerCase();
 let previous=await readLocal<Journal>(journalPrefix+journalKey);
 if(!previous){const legacy=(await listLocal<Journal>(journalPrefix)).find(row=>row.key.toLowerCase()===journalPrefix+journalKey);if(legacy){journalKey=legacy.key.slice(journalPrefix.length);previous=legacy.value;}}
 if(previous&&!['rejected','reverted','replaced'].includes(previous.state))return confirmJournal(s,journalKey,previous);
 if((await transactionHistory(s.account,d.chainId)).some(j=>['awaiting-wallet','submitted'].includes(j.state)))throw new Error('Resolve the unfinished request in My workspace → Transaction recovery before sending another transaction.');
 const data=encodeFunctionData({abi:call.abi,functionName:call.functionName,args:call.args}),value=call.value||0n;
 const simulated=await s.read.simulateContract({...call,account:s.account});
 await assertSession(s);
 const nonce=await s.read.getTransactionCount({address:s.account,blockTag:'pending'});
 const journal:Journal={version:1,chainId:d.chainId,account:s.account,to:call.address,data,value:value.toString(),nonce,label:call.functionName,createdAt:Date.now(),state:'awaiting-wallet'};
 // Save intent before showing a wallet prompt: ambiguous interrupted sends cannot silently repeat.
 await saveLocal(journalPrefix+journalKey,journal);
 report(s,{message:'Review and approve this transaction in your selected wallet.'});
 let hash:Hex;
 try{await assertSession(s);}catch(error){await saveLocal(journalPrefix+journalKey,{...journal,state:'rejected'});throw error;}
 try{hash=await s.wallet.writeContract({...simulated.request,account:s.account,chain:s.wallet.chain,nonce});}
 catch(error){if(explicitlyRejected(error))await saveLocal(journalPrefix+journalKey,{...journal,state:'rejected'});throw error;}
 const submitted:Journal={...journal,hash,state:'submitted'};
 await saveLocal(journalPrefix+journalKey,submitted);
 report(s,{message:'Transaction submitted.',hash});
 return confirmJournal(s,journalKey,submitted);
}

const localLocks=new Set<string>();
export async function clearUserRejectedRequest(s:Session,key:string,userConfirmed:boolean){
 const name=`carve-wallet:${(s.deployment||DEPLOYMENT).chainId}:${s.account.toLowerCase()}`;
 const clear=async()=>{if(localLocks.has(name))throw new Error('Another wallet request is running. Finish it first.');localLocks.add(name);try{
  const d=await assertSession(s),j=await readLocal<Journal>(journalPrefix+key);
  const [latest,pending]=await Promise.all([s.read.getTransactionCount({address:s.account,blockTag:'latest'}),s.read.getTransactionCount({address:s.account,blockTag:'pending'})]);
  checkRejectedRequest(j,s.account,d.chainId,latest,pending,userConfirmed);await assertSession(s);
  await saveLocal(journalPrefix+key,{...j!,state:'rejected',userConfirmedRejectionAt:Date.now(),checkedUnusedNonce:latest});
  return 'Rejected request cleared. No transaction was sent. Review your draft before launching.';
 }finally{localLocks.delete(name);}};
 if(typeof navigator!=='undefined'&&navigator.locks)return navigator.locks.request(name,{ifAvailable:true},lock=>{if(!lock)throw new Error('Another Carve tab has an active request. Finish it first.');return clear();});
 return clear();
}
export async function sendChecked(s:Session,call:Call,key?:string):Promise<TransactionReceipt>{
 const name=`carve-wallet:${(s.deployment||DEPLOYMENT).chainId}:${s.account.toLowerCase()}`;
 const execute=async()=>{if(localLocks.has(name))throw new Error('Another wallet request is running. Finish it first.');localLocks.add(name);try{return await sendUnlocked(s,call,key);}finally{localLocks.delete(name);}};
 if(typeof navigator!=='undefined'&&navigator.locks)return navigator.locks.request(name,{ifAvailable:true},lock=>{if(!lock)throw new Error('Another Carve tab has an active wallet request. Finish that request first.');return execute();});
 return execute();
}

export async function inscribeAsset(s:Session,asset:ContentAsset){
 const d=await assertSession(s);validateMediaBytes(asset);
 if(keccak256(asset.bytes)!==asset.keccak)throw new Error('Local asset integrity check failed.');
 const chunks=splitChunks(asset.bytes),hashes=chunks.map(c=>keccak256(c)),pointers:Address[]=[];
 for(let i=0;i<chunks.length;i++){
  await assertSession(s);
  report(s,{message:`Inscribe ${asset.kind}: chunk ${i+1} of ${chunks.length}`,completed:i,total:chunks.length});
  let pointer=await s.read.readContract({address:d.registry,abi:REGISTRY_ABI,functionName:'pointerForHash',args:[hashes[i]]});
  if(pointer===zeroAddress){
   await sendChecked(s,{address:d.registry,abi:REGISTRY_ABI,functionName:'writeChunk',args:[bytesToHex(chunks[i])]},`${d.chainId}:${d.registry}:${s.account}:chunk:${hashes[i]}`);
   pointer=await s.read.readContract({address:d.registry,abi:REGISTRY_ABI,functionName:'pointerForHash',args:[hashes[i]]});
  }
  await readPointer(s.read,pointer,hashes[i]);pointers.push(pointer);
 }
 const root=contentRoot(asset.mime,'identity',BigInt(asset.bytes.length),pointers,hashes);
 if(!await s.read.readContract({address:d.registry,abi:REGISTRY_ABI,functionName:'exists',args:[root]}))
  await sendChecked(s,{address:d.registry,abi:REGISTRY_ABI,functionName:'registerContent',args:[asset.mime,'identity',BigInt(asset.bytes.length),pointers,hashes]},`${d.chainId}:${d.registry}:${s.account}:manifest:${root}`);
 const reconstructed=await reconstructContent(s.read,d.registry,root);
 if(reconstructed.hash!==asset.keccak)throw new Error('Onchain reconstruction did not match your original file.');
 return root;
}

export async function launchDraft(s:Session,draft:Draft){
 if((s.deployment||DEPLOYMENT).curveVersion===4)return (await import('./curve-launch')).launchCurveDraft(s,draft);
 if((s.deployment||DEPLOYMENT).kind==='v3')return (await import('./v3-launch')).launchV3Draft(s,draft);
 // New launches must not accidentally use the previous private-curve architecture.
 if(!s.deployment)throw new Error('The immediate-trading upgrade is not deployed yet. Existing tokens remain readable.');
 const issues=validateDraft(draft);if(issues.length)throw new Error(issues.join(' '));
 for(const asset of Object.values(draft.assets))if(asset)validateMediaBytes(asset);
 const d=await verifyDeployment(s);
 const image=draft.assets.image?await inscribeAsset(s,draft.assets.image):zeroHash;
 const audio=draft.assets.audio?await inscribeAsset(s,draft.assets.audio):zeroHash;
 const website=draft.assets.website?await inscribeAsset(s,draft.assets.website):zeroHash;
 const initialBuy=parseEther(draft.initialBuy||'0'),bps=creatorBasisPoints(draft);
 const net=initialBuy*BigInt(9900-bps)/10000n,cap=parseEther('4.2'),acceptedNet=net>cap?cap:net;
 const minOut=10n**27n*acceptedNet/(parseEther('1.68')+acceptedNet);
 const identity=keccak256(stringToHex(JSON.stringify([draft.name.trim(),draft.symbol.trim(),image,audio,website,bps,initialBuy.toString()])));
 const receipt=await sendChecked(s,{address:d.factory,abi:FACTORY_ABI,functionName:'launch',args:[draft.name.trim(),draft.symbol.trim(),image,audio,website,bps,minOut,BigInt(Math.floor(Date.now()/1000)+1200)],value:parseEther('0.0005')+initialBuy},`${d.chainId}:${d.factory}:${s.account}:launch:${identity}`);
 const events=parseEventLogs({abi:FACTORY_ABI,eventName:'Launched',logs:receipt.logs.filter(l=>same(l.address,d.factory))});
 const event=events.find(e=>same(e.args.creator,s.account)&&e.args.imageRoot===image&&e.args.audioRoot===audio&&e.args.websiteRoot===website);
 if(!event)throw new Error('Launch receipt could not be verified. Do not repeat the launch; inspect the transaction.');
 const token=event.args.token,market=event.args.market;
 const [registered,...recordedRoots]=await Promise.all([
  s.read.readContract({address:d.factory,abi:FACTORY_ABI,functionName:'marketForToken',args:[token]}),
  ...(['imageRoot','audioRoot','websiteRoot'] as const).map(functionName=>s.read.readContract({address:token,abi:TOKEN_ABI,functionName}))
 ]);
 if(!same(registered,market)||recordedRoots.some((root,i)=>root!==[image,audio,website][i]))throw new Error('Launched token bindings failed verification.');
 await saveLocal(`carve-launch-v2:${d.chainId}:${token}`,{token,market,creator:s.account,hash:receipt.transactionHash,image,audio,website});
 report(s,{message:'Token launched. File bytes and contract bindings verified.',hash:receipt.transactionHash});
 return {token,market,hash:receipt.transactionHash};
}
