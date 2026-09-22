import {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,LoaderCircle} from 'lucide-react';
import {client,DEPLOYMENT,short,type Deployment} from '../lib/chain';
import {useWallet} from '../lib/wallet';
import {WalletDialog} from './WalletDialog';
import {launchDraft,type Progress,type Session} from '../lib/transactions';
import {validateDraft,type Draft} from '../lib/assets';
import {v3LaunchPlan} from '../lib/v3-launch-plan';
import {WalletRequestHelp} from './TransactionRecovery';
import {keccak256,stringToHex} from 'viem';
import {readLocal,saveLocal} from '../lib/storage';
import {openLaunchAttempt,completeLaunchAttempt} from '../lib/launch-attempt';

export function useTransactionSession(onProgress:(p:Progress)=>void,deployment:Deployment=DEPLOYMENT){
 const w=useWallet(),latest=useRef(w),mounted=useRef(true);latest.current=w;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const getSession=():Session=>{
  if(!w.address||!w.wallet)throw new Error('Connect your wallet first.');
  const account=w.address,uuid=w.selected?.info.uuid;
  return {read:client,wallet:w.wallet,account,deployment,isCurrent:()=>mounted.current&&latest.current.address?.toLowerCase()===account.toLowerCase()&&latest.current.selected?.info.uuid===uuid&&latest.current.chainId===4663,onProgress};
 };
 return {w,getSession};
}
export function LaunchAction({draft}:{draft:Draft}){
 const curve=[4,5].includes(DEPLOYMENT.curveVersion||0),plan=v3LaunchPlan(draft),oldCreatorFee=!curve&&Number(draft.creatorFee||'0')!==0;
 const [progress,setProgress]=useState<Progress|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<Awaited<ReturnType<typeof launchDraft>>|null>(null);
 const {w,getSession}=useTransactionSession(setProgress);
 const identity=JSON.stringify([draft.name,draft.symbol,draft.creatorFee,draft.autoBuyback===true,draft.initialBuy,...Object.values(draft.assets).map(a=>a?.keccak)]);
 useEffect(()=>{if(!busy){setResult(null);setError('');setProgress(null);}},[identity,w.address]);
 const run=async()=>{setBusy(true);setError('');try{const session=getSession(),store={read:readLocal,save:saveLocal},attemptKey='carve-ui-launch:'+DEPLOYMENT.factory+':'+session.account.toLowerCase()+':'+keccak256(stringToHex(identity));
 const attempt=await openLaunchAttempt(store,attemptKey,()=>crypto.randomUUID());
 const launched=await launchDraft({...session,launchAttemptId:attempt.id},structuredClone(draft));setResult(launched);
 try{await completeLaunchAttempt(store,attemptKey,attempt.id);}catch{/* The mined result remains visible; an unchanged attempt safely resumes the same receipt. */}
 location.hash='/explore?token='+launched.token+'&view=trade';}catch(e){setError(e instanceof Error?e.message:'Request failed. Check wallet Activity before retrying.');}finally{setBusy(false);}};
 return <div className="live-launch-action">
 <p>Creation fee: <strong>0.0005 ETH</strong> + your initial buy and storage gas. {curve?<>Trading fee: <strong>1% Carve + {draft.creatorFee||'0'}% creator</strong>.</>:<>Pool trading fee: <strong>1% total</strong>. No additional creator trading fee.</>}</p>
 <p>{plan.inline?(curve?'One wallet approval includes the selected media, token, bonding curve and optional initial buy.':'One wallet approval includes the selected media, token, locked pool and optional initial buy.'):'Up to '+plan.transactions+' approvals for these files and the launch. Existing confirmed chunks and manifests are reused.'}</p>
 {DEPLOYMENT.curveVersion===5&&<p><strong>Automatic buyback & burn: {draft.autoBuyback?'On':'Off'}.</strong> {draft.autoBuyback?'Your creator fee is split 20% creator revenue / 80% token buyback and burn. Trades trigger bounded processing; no timer or keeper. The choice is permanent, and eligible trades use extra gas.':'The full creator fee remains creator revenue.'}</p>}
 {oldCreatorFee&&<p className="warning">This saved draft includes an old creator-fee setting. Clear it in Set up your launch before continuing.</p>}
 {!DEPLOYMENT.launchEnabled||(!curve&&DEPLOYMENT.kind!=='v3')?<p className="muted">Launches are temporarily unavailable while the current release is being verified. Your draft and existing inscriptions remain saved.</p>:<>
 {!w.address?<WalletDialog/>:w.chainId!==4663?<button className="secondary full" onClick={()=>w.switchChain()}>Switch to Robinhood Chain</button>:<>
 <button className="primary full" disabled={busy||oldCreatorFee||!!validateDraft(draft).length||!!result} onClick={run}>{busy?<><LoaderCircle className="spin" size={17}/>Processing…</>:result?'Launch confirmed':'Inscribe and launch'}</button></>}
 </>}
 {progress&&<div className="transaction-status" role="status"><p>{progress.message}</p>{progress.hash&&<a target="_blank" rel="noreferrer" href={'https://robinhoodchain.blockscout.com/tx/'+progress.hash}>View transaction <ArrowUpRight size={14}/></a>}</div>}
 {error&&<p className="error" role="alert">{error}</p>}
 <WalletRequestHelp onResolved={()=>setError('')}/>
 {result&&<div className="notice"><div><strong>Launched successfully</strong><p>{short(result.token,10)}</p><a href={'#/explore?token='+result.token}>Open your token and inscription proofs <ArrowUpRight size={14}/></a></div></div>}
 </div>;
}
