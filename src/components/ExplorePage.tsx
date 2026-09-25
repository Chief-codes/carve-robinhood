import {useEffect,useRef,useState} from 'react';
import {ArrowRight,ArrowUpRight,LoaderCircle,Search} from 'lucide-react';
import {zeroHash,type Address} from 'viem';
import {inspectToken,short} from '../lib/chain';
import {useWallet} from '../lib/wallet';
import {InscriptionProof,TokenTrading} from './OnchainToken';
import {LaunchFeed} from './LaunchFeed';
import {TokenThumbnail} from './TokenThumbnail';

export function ExplorePage(){
 const [copyStatus,setCopyStatus]=useState('');
 const [address,setAddress]=useState(''),[result,setResult]=useState<Awaited<ReturnType<typeof inspectToken>>|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),revision=useRef(0),w=useWallet();
 const inspect=async(value:string)=>{const run=++revision.current;setError('');setCopyStatus('');setResult(null);setBusy(true);try{const token=await inspectToken(value.trim());if(run===revision.current)setResult(token);}catch(e){if(run===revision.current)setError((e as Error).message);}finally{if(run===revision.current)setBusy(false);}};
 useEffect(()=>{const read=()=>{const value=new URLSearchParams(location.hash.split('?')[1]||'').get('token')||'';setAddress(value);if(value)inspect(value);else{revision.current++;setResult(null);setBusy(false);setError('');}};read();window.addEventListener('hashchange',read);return()=>{revision.current++;window.removeEventListener('hashchange',read);};},[]);
 return <><div className="page-heading compact"><div><div className="eyebrow">THE CHAIN IS THE SOURCE</div><h1>Explore <em>launches.</em></h1><p>Live Carve launches. Original media. Read directly from Robinhood.</p></div><a className="primary" href="#/studio">Create a token <ArrowUpRight size={17}/></a></div>
 {!result&&!address&&<LaunchFeed/>}
 <section className="panel lookup-panel"><div className="section-title"><span className="section-number">↗</span><div><h2>Inspect a token</h2><p>Enter a Robinhood ERC-20 address. Contract data is read from the chain.</p></div></div>
 <form className="search-row" onSubmit={e=>{e.preventDefault();const target='#/explore?token='+encodeURIComponent(address.trim());if(location.hash===target)inspect(address);else location.hash=target;}}><label className="visually-hidden" htmlFor="token-address">Token contract address</label><Search size={19}/><input id="token-address" placeholder="0x… token contract address" value={address} onChange={e=>{revision.current++;setAddress(e.target.value);setResult(null);setBusy(false);setError('');}}/><button className="primary" disabled={busy}>{busy?<LoaderCircle className="spin" size={17}/>:<>Inspect<ArrowRight size={17}/></>}</button></form>
 {error&&<p className="error" role="alert">{error}</p>}</section>
 {result&&<section className="token-workspace"><article className="panel inspection-result"><div className="inspection-identity">{result.registry&&<div className="inspection-token-image"><TokenThumbnail registry={result.registry} root={result.roots[0]||zeroHash} name={result.name} audio={!!result.roots[1]&&result.roots[1]!==zeroHash} website={!!result.roots[2]&&result.roots[2]!==zeroHash}/></div>}<div><span className="status-tag">READ FROM CHAIN</span><h2>{result.name} <span>${result.symbol}</span></h2><code className="full-address">{result.address}</code><div className="button-row"><button className="secondary" onClick={async()=>{try{await navigator.clipboard.writeText(result.address);setCopyStatus('Contract address copied.');}catch{setCopyStatus('Select and copy the full address above.');}}}>Copy contract address</button><a href={'https://robinhoodchain.blockscout.com/token/'+result.address} target="_blank" rel="noreferrer">Explorer <ArrowUpRight size={15}/></a></div>{copyStatus&&<p role="status">{copyStatus}</p>}</div></div><dl className="inspection-stats"><div><dt>Total supply</dt><dd>{result.supply}</dd></div><div><dt>Inscription status</dt><dd>{result.inscribed?'Creative record found':'No Carve record found'}</dd></div></dl></article><TokenTrading key={result.address+':'+w.address+':'+w.selected?.info.uuid} token={result.address as Address} symbol={result.symbol}/></section>}
 {result&&result.registry&&result.inscribed&&<div className="onchain-sections"><InscriptionProof key={result.address+result.registry} token={result.address as Address} registry={result.registry} roots={result.roots}/></div>}
 {(result||address)&&<LaunchFeed/>}
 </>;
}
