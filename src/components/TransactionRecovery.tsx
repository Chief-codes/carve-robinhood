import {useEffect,useState} from 'react';
import {isHex,type Hex} from 'viem';
import {recoverTransaction,clearUserRejectedRequest,transactionHistory,type Progress} from '../lib/transactions';
import {useTransactionSession} from './LaunchAction';

export function WalletRequestHelp({onResolved}:{onResolved?:()=>void}){
 const [items,setItems]=useState<Awaited<ReturnType<typeof transactionHistory>>>([]),[hash,setHash]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[version,setVersion]=useState(0);
 const {w,getSession}=useTransactionSession((p:Progress)=>setMessage(p.message));
 useEffect(()=>{let active=true;setItems([]);if(w.address)transactionHistory(w.address,4663).then(rows=>{if(active)setItems(rows);}).catch(()=>{if(active)setError('Cannot read saved wallet requests. Preserve browser data and check wallet Activity.');});return()=>{active=false;};},[w.address,version]);
 const pending=items.filter(j=>['awaiting-wallet','submitted'].includes(j.state));
 if(!w.address||(!pending.length&&!message&&!error))return null;
 const run=async(action:()=>Promise<string>)=>{setBusy(true);setError('');try{setMessage(await action());setVersion(v=>v+1);onResolved?.();}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 return <div className="wallet-request-help">{pending.map(j=><div className="notice" key={j.key}><div><strong>Previous wallet request</strong><p>{j.hash?'This transaction was submitted. Verify it before starting another launch.':'If you rejected this request in your wallet, you can clear it after checking that no transaction is pending. Never clear a request that you approved or submitted.'}</p>{!j.hash&&<button className="secondary" disabled={busy} onClick={()=>run(()=>clearUserRejectedRequest(getSession(),j.key,true))}>I rejected it — check and clear</button>}<details><summary>{j.hash?'Verify submitted transaction':'Already submitted? Verify its hash'}</summary><label>Transaction hash<input value={hash||j.hash||''} placeholder="0x… from wallet Activity" onChange={e=>setHash(e.target.value)}/></label><button className="secondary" disabled={busy} onClick={()=>run(async()=>{const value=hash||j.hash||'';if(!isHex(value)||value.length!==66)throw new Error('Enter the full transaction hash from wallet Activity.');return recoverTransaction(getSession(),j.key,value as Hex);})}>Verify transaction</button></details></div></div>)}{message&&<p role="status">{message}</p>}{error&&<p className="error" role="alert">{error}</p>}</div>;
}
