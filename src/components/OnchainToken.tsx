import {useEffect,useRef,useState} from 'react';
import {formatEther,parseEther,parseUnits,zeroHash,zeroAddress,isAddress,type Address,type Hex} from 'viem';
import {ArrowUpRight,Download,ShieldCheck} from 'lucide-react';
import {client,DEPLOYMENT,LEGACY_DEPLOYMENT,V3_DEPLOYMENT,TOKEN_ABI,MARKET_ABI,ENGINE_ABI,ROUTER_ABI} from '../lib/chain';
import {reconstructContent,validateMediaBytes} from '../lib/inscriptions';
import {isolatedHtml,download,type AssetKind} from '../lib/assets';
import {mediaDataURI,mediaExtension} from '../lib/media-export';
import {findMarket,quoteTrade,executeTrade,type TradeQuote} from '../lib/trading';
import {sendChecked,type Progress} from '../lib/transactions';
import {useTransactionSession} from './LaunchAction';
import {WalletDialog} from './WalletDialog';
import {V3TokenTrading} from './V3TokenTrading';
import {V3_FACTORY_ABI} from '../lib/v3-contracts';

const scan='https://robinhoodchain.blockscout.com';
function displayETH(value:bigint){
 if(value>0n&&value<1_000_000_000_000n)return '<0.000001';
 const [whole,fraction='']=formatEther(value).split('.');
 const trimmed=fraction.slice(0,6).replace(/0+$/,'');
 return trimmed?whole+'.'+trimmed:whole;
}
export function InscriptionProof({registry,roots}:{registry:Address;roots:(Hex|null)[]}){
 const [copyURL,setCopyURL]=useState<{root:Hex;value:string}|null>(null),[copied,setCopied]=useState(false);
 const [files,setFiles]=useState<Awaited<ReturnType<typeof reconstructContent>>[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[urls,setUrls]=useState<string[]>([]);
 useEffect(()=>{const values=files.map(f=>URL.createObjectURL(new Blob([Uint8Array.from(f.bytes)],{type:f.mime})));setUrls(values);return()=>values.forEach(u=>URL.revokeObjectURL(u));},[files]);
 useEffect(()=>{setFiles([]);setError('');setCopyURL(null);setCopied(false);},[registry,roots.join(',')]);
 const proofKey=registry+roots.join(','),proofCurrent=useRef(proofKey),proofAlive=useRef(true);proofCurrent.current=proofKey;
 useEffect(()=>{proofAlive.current=true;return()=>{proofAlive.current=false;};},[]);
 const verify=async()=>{const key=proofKey;setBusy(true);setError('');try{const result=[];for(let i=0;i<roots.length;i++){if(!roots[i]||roots[i]===zeroHash)continue;const file=await reconstructContent(client,registry,roots[i]!);validateMediaBytes({kind:(['image','audio','website'] as AssetKind[])[i],mime:file.mime,bytes:file.bytes});result.push(file);}if(proofAlive.current&&proofCurrent.current===key)setFiles(result);}catch(e){if(proofAlive.current&&proofCurrent.current===key)setError((e as Error).message);}finally{if(proofAlive.current&&proofCurrent.current===key)setBusy(false);}};
 return <section className={'panel inscription-proof'+(files.length?' is-verified':'')}><h2><ShieldCheck size={20}/> Onchain inscription</h2><p>Reconstruct the actual bytes from contract bytecode and verify every chunk and manifest.</p><div className="button-row"><button className="secondary" onClick={verify} disabled={busy}>{busy?'Verifying stored bytes…':'Verify inscription'}</button><a href={scan+'/address/'+registry+'?tab=read_contract'} target="_blank" rel="noreferrer">Content registry <ArrowUpRight size={14}/></a></div>{error&&<p className="error" role="alert">{error}</p>}
 {files.map((f,i)=><article className="proof-file" key={f.root}><strong>{f.mime} · {f.bytes.length.toLocaleString()} bytes · byte integrity verified</strong><code className="full-address">{f.root}</code>{f.mime.startsWith('image/')?<img src={urls[i]} alt="Reconstructed onchain token image" onError={()=>setError('Stored bytes passed integrity checks, but this browser could not decode an image. Download the original file to inspect it.')}/>:f.mime.startsWith('audio/')?<audio controls src={urls[i]} preload="none" onError={()=>setError('Stored bytes passed integrity checks, but this browser could not play the audio. Its codec or file may not be supported.')}/>:f.mime==='text/html'?<iframe title="Verified onchain website" sandbox="allow-scripts" srcDoc={isolatedHtml(new TextDecoder().decode(f.bytes))}/>:null}<div className="button-row"><button className="secondary" onClick={()=>download('carve-inscription-'+i+'.'+mediaExtension(f.mime),Uint8Array.from(f.bytes),f.mime)}><Download size={14}/>Download bytes</button><button className="secondary" onClick={async()=>{const value=mediaDataURI(f.mime,f.bytes);setCopyURL({root:f.root,value});try{await navigator.clipboard.writeText(value);setCopied(true);}catch{setCopied(false);}}}>Copy media data URL</button><button className="text-link" onClick={()=>download('carve-proof-'+i+'.json',JSON.stringify({version:1,chainId:4663,registry,root:f.root,mime:f.mime,encoding:f.encoding,encodedByteLength:f.encodedByteLength,decodedHash:f.hash,encodedHash:f.encodedHash,pointers:f.pointers,chunkHashes:f.chunkHashes,scope:'Byte integrity; not token safety or uploader identity.'},null,2))}>Download proof</button></div>{copyURL?.root===f.root&&<div className="proof-copy"><p role="status">{copied?'Copied. Paste into a browser address bar.':'Clipboard unavailable. Select and copy the URL below.'} This URL is generated locally from the reconstructed bytes. For large files, use Download bytes.</p>{f.mime==='text/html'&&<p className="warning">Unknown HTML can run scripts. The isolated preview above is safer than opening it unrestricted.</p>}<label>Verified bytes as a data URL<textarea readOnly rows={3} value={copyURL.value} onFocus={e=>e.target.select()}/></label></div>}<details><summary>Stored chunk addresses</summary>{f.pointers.map(p=><a key={p} className="full-address" href={scan+'/address/'+p+'?tab=contract_code'} target="_blank" rel="noreferrer">{p} <ArrowUpRight size={12}/></a>)}</details></article>)}
 </section>;
}

export function TokenTrading(props:{token:Address;symbol:string}){
 const [kind,setKind]=useState<'loading'|'curve'|'v3'|'legacy'|'other'|'error'>('loading');
 useEffect(()=>{let active=true;setKind('loading');
  (async()=>{
   let next:'curve'|'v3'|'legacy'|'other'='other';
   if(DEPLOYMENT.curveVersion===4&&await findMarket(client,props.token,DEPLOYMENT))next='curve';
   else if(V3_DEPLOYMENT.factory&&(await client.readContract({address:V3_DEPLOYMENT.factory,abi:V3_FACTORY_ABI,functionName:'poolForToken',args:[props.token]}))!==zeroAddress)next='v3';
   else if(await findMarket(client,props.token,LEGACY_DEPLOYMENT))next='legacy';
   if(active)setKind(next);
  })().catch(()=>{if(active)setKind('error');});return()=>{active=false;};
 },[props.token]);
 if(kind==='curve')return <LegacyTokenTrading {...props}/>;
 if(kind==='v3')return <V3TokenTrading {...props}/>;
 return <section className="panel"><h2>{kind==='legacy'?'Previous test contract':kind==='loading'?'Checking trading market…':'Trading market unavailable'}</h2><p>{kind==='legacy'?'This token uses a previous test curve. Its onchain media remains verifiable; it has not been migrated or replaced.':kind==='loading'?'Reading this token’s registered factory and market.':kind==='error'?'The public RPC could not confirm this token’s market. Reload to retry.':'This token is not registered with a supported Carve factory.'}</p></section>;
}
function LegacyTokenTrading({token,symbol}:{token:Address;symbol:string}){
 const [market,setMarket]=useState<Address|null>(null),[phase,setPhase]=useState<number|null>(null),[reserve,setReserve]=useState(0n),[creatorFee,setCreatorFee]=useState(0),[buy,setBuy]=useState(true),[amount,setAmount]=useState(''),[slippage,setSlippage]=useState('0.5'),[quote,setQuote]=useState<TradeQuote|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[progress,setProgress]=useState<Progress|null>(null),[credits,setCredits]=useState<{address:Address;label:string;value:bigint;asset?:Address}[]>([]),[assetBalance,setAssetBalance]=useState(0n);
 const alive=useRef(true),readVersion=useRef(0);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;readVersion.current++;};},[]);
 const {w,getSession}=useTransactionSession(p=>{if(alive.current)setProgress(p);});
 const identity=token+':'+w.address+':'+w.chainId,current=useRef(identity);current.current=identity;
 const refresh=async()=>{
  const key=identity,version=++readVersion.current;
  const valid=()=>alive.current&&current.current===key&&version===readVersion.current;
  const m=await findMarket(client,token);if(!valid())return;setMarket(m);if(!m)return;
  const [p,r,c]=await Promise.all([
   client.readContract({address:m,abi:MARKET_ABI,functionName:'phase'}),
   client.readContract({address:m,abi:MARKET_ABI,functionName:'reserveETH'}),
   client.readContract({address:m,abi:MARKET_ABI,functionName:'creatorFeeBps'}),
  ]);
  if(!valid())return;setPhase(p);setReserve(r);setCreatorFee(c);
  if(!w.address||!DEPLOYMENT.router||!DEPLOYMENT.engine){setCredits([]);setAssetBalance(0n);return;}
  const list=await Promise.all([{address:m,label:'Curve fees / returned payment credit',abi:MARKET_ABI},{address:DEPLOYMENT.router,label:'Returned payment credit',abi:ROUTER_ABI}].map(async v=>({address:v.address,label:v.label,value:await client.readContract({address:v.address,abi:v.abi,functionName:'pendingETH',args:[w.address!]})})));
  const [fees,balance]=await Promise.all([
   Promise.all((['0x0000000000000000000000000000000000000000',token] as Address[]).map(async asset=>({address:DEPLOYMENT.engine!,asset,label:asset===token?'Creator / platform token fees':'Creator / platform ETH fees',value:await client.readContract({address:DEPLOYMENT.engine!,abi:ENGINE_ABI,functionName:'feeCredit',args:[w.address!,asset]})}))),
   buy?client.getBalance({address:w.address}):client.readContract({address:token,abi:TOKEN_ABI,functionName:'balanceOf',args:[w.address]}),
  ]);
  if(valid()){setCredits([...list,...fees]);setAssetBalance(balance);}
 };
 useEffect(()=>{setMarket(null);setQuote(null);setCredits([]);setAssetBalance(0n);setError('');refresh().catch(e=>{if(alive.current&&current.current===identity)setError((e as Error).message);});return()=>{readVersion.current++;};},[token,w.address,w.chainId,buy]);
 const action=async(fn:()=>Promise<unknown>)=>{setBusy(true);setError('');try{await fn();if(alive.current&&current.current===identity)await refresh();}catch(e){if(alive.current&&current.current===identity)setError((e as Error).message);}finally{if(alive.current)setBusy(false);}};
 if(!market)return error?<section className="panel"><h2>Market read unavailable</h2><p className="error">{error}</p><button className="secondary" onClick={()=>action(refresh)}>Retry</button></section>:null;
 const setPercent=(percent:number)=>{if(assetBalance===0n)return;setAmount(formatEther(assetBalance*BigInt(percent)/100n));setQuote(null);};
 const setDirection=(next:boolean)=>{if(next===buy)return;setBuy(next);setAmount('');setQuote(null);};
 const cap=parseEther('4.2'),progressBps=phase===2?10000:reserve*10000n/cap;
 return <section className="panel token-trading"><div className="feed-heading"><div><h2>Trade ${symbol}</h2><p className="trade-subtitle">Market order · {phase===2?'locked liquidity pool':'Carve bonding curve'}</p></div><span className="status-tag">{phase===2?'POOL':'CURVE'}</span></div><p>1% Carve + {(creatorFee/100).toFixed(2)}% creator.</p>{phase===0&&<div className="curve-readout"><div><span>Bonding curve</span><strong>{Number(progressBps)/100}%</strong></div><progress max={10000} value={Number(progressBps)} aria-label={symbol+' bonding curve progress'}/><small>{displayETH(reserve)} ETH of 4.2 ETH reserve · {displayETH(cap-reserve)} ETH remaining before automatic migration.</small></div>}{phase===0&&reserve>=cap&&<div className="notice"><div><strong>Curve funded · migration ready</strong><p>The automatic pool migration has not completed. Funds remain in the contract; anyone can retry migration.</p>{!w.address?<WalletDialog/>:w.chainId!==4663?<button className="secondary" onClick={()=>w.switchChain()}>Switch to Robinhood</button>:<button className="primary" disabled={busy||!DEPLOYMENT.launchEnabled} onClick={()=>action(()=>sendChecked(getSession(),{address:market,abi:MARKET_ABI,functionName:'graduate',args:[0n,BigInt(Math.floor(Date.now()/1000)+300)]}))}>Complete migration in wallet</button>}</div></div>}<div className="trade-shell"><div className="trade-mode"><div className="trade-direction" role="group" aria-label="Trade direction"><button className={buy?'active':''} aria-pressed={buy} disabled={busy} onClick={()=>setDirection(true)}>Buy</button><button className={!buy?'active':''} aria-pressed={!buy} disabled={busy} onClick={()=>setDirection(false)}>Sell</button></div><span>{(1+creatorFee/100).toFixed(2)}% total fee</span></div><label className="swap-field"><span>{buy?'You pay':'You sell'}</span><div><input aria-label={buy?'ETH to spend':symbol+' to sell'} placeholder="0.0" inputMode="decimal" disabled={busy} value={amount} onChange={e=>{setAmount(e.target.value);setQuote(null);}}/><strong>{buy?'ETH':symbol}</strong></div><small>{w.address?'Available: '+displayETH(assetBalance)+' '+(buy?'ETH':symbol):'Connect wallet to see balance'}</small></label><div className="quick-percentages" aria-label="Quick amount"><button disabled={busy||assetBalance===0n} onClick={()=>setPercent(25)}>25%</button><button disabled={busy||assetBalance===0n} onClick={()=>setPercent(50)}>50%</button><button disabled={busy||assetBalance===0n} onClick={()=>setPercent(75)}>75%</button><button disabled={busy||assetBalance===0n} onClick={()=>setPercent(100)}>Max</button></div><label className="swap-field"><span>You receive</span><div><output>{quote?displayETH(quote.amountOut):'—'}</output><strong>{buy?symbol:'ETH'}</strong></div><small>{quote?'Live quote · block '+quote.block.toString():'Preview to read the latest onchain quote'}</small></label><label className="slippage-row">Slippage <input aria-label="Slippage percent" inputMode="decimal" disabled={busy} value={slippage} onChange={e=>setSlippage(e.target.value)}/><span>%</span></label></div><button className="secondary full" disabled={busy} onClick={()=>action(async()=>{if(!/^\d+(\.\d{1,18})?$/.test(amount))throw new Error('Enter a positive amount with up to 18 decimal places.');const result=await quoteTrade(client,token,buy,parseEther(amount));if(alive.current&&current.current===identity)setQuote(result);})}>{busy?'Checking…':quote?'Refresh live quote':'Preview swap'}</button>{quote&&<div className="transaction-status"><p>Estimated output: <strong>{displayETH(quote.amountOut)} {buy?symbol:'ETH'}</strong></p>{quote.refund>0n&&<p>Excess returned: {displayETH(quote.refund)} ETH</p>}<p>Read from the latest available Robinhood Chain block. The quote expires after 60 seconds; refresh it before approving if it is older.</p>{!w.address?<WalletDialog/>:w.chainId!==4663?<button className="secondary full" onClick={()=>w.switchChain()}>Switch to Robinhood</button>:<button className="primary full" disabled={busy||!DEPLOYMENT.launchEnabled} onClick={()=>action(async()=>{if(!/^\d(?:\.\d{1,2})?$/.test(slippage))throw new Error('Enter slippage from 0% to 5%.');await executeTrade(getSession(),quote,Number(parseUnits(slippage,2)));if(alive.current)setQuote(null);})}>Review {buy?'buy':'sell'} in wallet</button>}</div>}
 {credits.filter(c=>c.value>0n).map(c=><div className="credit-row" key={c.address+(c.asset||'')}><span>{c.label}<strong>{formatEther(c.value)} {c.asset===token?symbol:'ETH'}</strong></span><button className="secondary" disabled={busy||!DEPLOYMENT.launchEnabled} onClick={()=>action(()=>sendChecked(getSession(),{address:c.address,abi:c.asset?ENGINE_ABI:MARKET_ABI,functionName:c.asset?'withdrawFees':'withdrawETH',args:c.asset?[c.asset,w.address!]:[w.address!]}))}>Withdraw</button></div>)}
 {progress&&<p role="status">{progress.message} {progress.hash&&<a href={scan+'/tx/'+progress.hash} target="_blank" rel="noreferrer">Transaction ↗</a>}</p>}{error&&<p className="error" role="alert">{error}</p>}<p className="muted">Sales and unused buy amounts are sent directly to your wallet. If a receiving smart wallet rejects ETH, the amount stays in withdrawable credit. Quotes can change; transactions are simulated before your approval.</p><a target="_blank" rel="noreferrer" href={scan+'/address/'+market+'?tab=read_contract'}>Read market contract <ArrowUpRight size={14}/></a></section>;
}
