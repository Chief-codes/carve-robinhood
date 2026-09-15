import {useEffect,useMemo,useRef,useState} from 'react';
import {formatEther,zeroHash,type Address,type Hex} from 'viem';
import {ArrowUpRight,Layers} from 'lucide-react';
import {client,DEPLOYMENT,FACTORY_ABI,MARKET_ABI,TOKEN_ABI,short} from '../lib/chain';
import {DEFAULT_LAUNCH_FEED_OPTIONS,filterLaunchFeed,type LaunchFeedRow,type LaunchFeedOptions} from '../lib/launch-feed';
import {prepareMetricsContext,readMarketSnapshot,readLifetimeCounterVolume,formatProgressPercent} from '../lib/market-metrics';
import {feedWindow,mergeFeed} from '../lib/feed-window';
import {TokenThumbnail} from './TokenThumbnail';
import {V3LaunchFeed} from './V3LaunchFeed';

type Row=LaunchFeedRow & {imageRoot:Hex;progressText:string|null;metricNote:string;block:bigint};
export function amountETH(value:bigint|null){if(value===null)return 'Unavailable';if(value===0n)return '0 ETH';if(value<1000000000000n)return '<0.000001 ETH';const [whole,fraction='']=formatEther(value).split('.'),decimals=fraction.slice(0,6).replace(/0+$/,'');return whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(decimals?'.'+decimals:'')+' ETH';}
export function LaunchFeed(props:{creator?:Address}){return DEPLOYMENT.kind==='v3'?<V3LaunchFeed {...props}/>:<LegacyLaunchFeed {...props}/>;}
function LegacyLaunchFeed({creator}:{creator?:Address}){
 const [rows,setRows]=useState<Row[]>([]),[cursor,setCursor]=useState<bigint|null>(null),[total,setTotal]=useState(0n),[busy,setBusy]=useState(false),[error,setError]=useState(''),[live,setLive]=useState(true),[updated,setUpdated]=useState(0),[filters,setFilters]=useState<LaunchFeedOptions>({...DEFAULT_LAUNCH_FEED_OPTIONS}),revision=useRef(0),loading=useRef(false);
 const state=useRef({cursor:null as bigint|null,total:0n,updated:0}),cache=useRef(new Map<string,{name:string;symbol:string;fee:number;image:Hex;audio:Hex;website:Hex}>());
 const visible=useMemo(()=>filterLaunchFeed(rows,filters),[rows,filters]);
 const load=async(mode:'initial'|'more'|'poll'='initial')=>{
  if(loading.current)return;loading.current=true;const run=++revision.current;
  try{
   const d=DEPLOYMENT;if(d.status!=='verified'||!d.factory||!d.engine||!d.registry||!d.deployedBlock)return;
   const observed=await client.readContract({address:d.factory,abi:FACTORY_ABI,functionName:'marketCount'});
   if(run!==revision.current)return;
   // Discovery is cheap. Refresh price snapshots less often, and never overlap reads.
   if(mode==='poll'&&observed===state.current.total&&Date.now()-state.current.updated<20_000)return;
   setBusy(true);setError('');
   const ctx=await prepareMetricsContext(client,{status:'verified',chainId:4663,factory:d.factory,engine:d.engine,registry:d.registry,deployedBlock:BigInt(d.deployedBlock)});
   const count=await client.readContract({address:d.factory,abi:FACTORY_ABI,functionName:'marketCount',blockNumber:ctx.blockNumber});
   const page=feedWindow(count,mode==='more'&&state.current.cursor!==null&&state.current.cursor<=count?state.current.cursor:null);
   const fetched=await Promise.all(page.indices.map(async index=>{
     if(run!==revision.current)return;
     const market=await client.readContract({address:d.factory!,abi:FACTORY_ABI,functionName:'markets',args:[index],blockNumber:ctx.blockNumber});
     const owner=await client.readContract({address:market,abi:MARKET_ABI,functionName:'creator',blockNumber:ctx.blockNumber});
     if(creator&&owner.toLowerCase()!==creator.toLowerCase())return;
     const snapshot=await readMarketSnapshot(ctx,market);
     let info=cache.current.get(snapshot.token.toLowerCase());
     if(!info){const [name,symbol,fee,image,audio,website]=await Promise.all([
      client.readContract({address:snapshot.token,abi:TOKEN_ABI,functionName:'name',blockNumber:ctx.blockNumber}),
      client.readContract({address:snapshot.token,abi:TOKEN_ABI,functionName:'symbol',blockNumber:ctx.blockNumber}),
      client.readContract({address:market,abi:MARKET_ABI,functionName:'creatorFeeBps',blockNumber:ctx.blockNumber}),
      client.readContract({address:snapshot.token,abi:TOKEN_ABI,functionName:'imageRoot',blockNumber:ctx.blockNumber}),
      client.readContract({address:snapshot.token,abi:TOKEN_ABI,functionName:'audioRoot',blockNumber:ctx.blockNumber}),
      client.readContract({address:snapshot.token,abi:TOKEN_ABI,functionName:'websiteRoot',blockNumber:ctx.blockNumber}),
     ]);
      info={name,symbol,fee:Number(fee),image,audio,website};if(cache.current.size>240)cache.current.clear();cache.current.set(snapshot.token.toLowerCase(),info);}
     const {name,symbol,fee,image,audio,website}=info,volume=await readLifetimeCounterVolume(ctx,snapshot);
     const progressText=formatProgressPercent(snapshot);
     return {index,market,token:snapshot.token,creator:owner,name,symbol,phase:snapshot.phase,reserve:snapshot.reserveETH,creatorFee:fee,imageRoot:image,hasImage:image!==zeroHash,hasAudio:audio!==zeroHash,hasWebsite:website!==zeroHash,
      marketCapETH:snapshot.fdv.status==='available'?snapshot.fdv.value.fdvWei:null,volumeETH:volume.status==='complete'?volume.wei:null,curveProgressBps:progressText===null?null:Number(progressText)*100,progressText,block:ctx.blockNumber,
      metricNote:[snapshot.fdv.status==='unavailable'?snapshot.fdv.reason:'',volume.status==='unavailable'?volume.reason:''].filter(Boolean).join(' · ')} satisfies Row;
   }));
   if(run===revision.current){const added=fetched.filter((row):row is Row=>!!row),previous=state.current;
    // A burst bigger than one page must not make the intervening launches unreachable.
    const nextCursor=mode!=='poll'||count-previous.total>12n||previous.cursor===null||previous.cursor>count?page.cursor:previous.cursor;
    const now=Date.now();state.current={cursor:nextCursor,total:count,updated:now};setRows(old=>mode==='initial'?added:mergeFeed(old,added,count));setCursor(nextCursor);setTotal(count);setUpdated(now);}
  }catch(e){if(run===revision.current)setError((e as Error).message);}
  finally{if(run===revision.current){loading.current=false;setBusy(false);}}
 };
 const loadRef=useRef(load);loadRef.current=load;
 useEffect(()=>{revision.current++;setRows([]);setCursor(null);setUpdated(0);cache.current.clear();state.current={cursor:null,total:0n,updated:0};loading.current=false;void loadRef.current('initial');return()=>{revision.current++;};},[creator]);
 useEffect(()=>{if(!live)return;const poll=()=>{if(document.visibilityState==='visible')void loadRef.current('poll');};const timer=window.setInterval(poll,5000);document.addEventListener('visibilitychange',poll);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',poll);};},[live,creator]);
 const set=<K extends keyof LaunchFeedOptions>(key:K,value:LaunchFeedOptions[K])=>setFilters(old=>({...old,[key]:value}));
 return <section className="panel feed-panel"><div className="feed-heading"><div><h2>{creator?'Your onchain launches':'Recent launches'}</h2><p className="feed-updated">{updated?'Latest snapshot '+new Date(updated).toLocaleTimeString():'Reading Robinhood Chain'}</p></div><div className="feed-live-controls"><label><input type="checkbox" checked={live} onChange={e=>setLive(e.target.checked)}/><span>{live?'Live updates':'Updates paused'}</span></label>{DEPLOYMENT.factory&&<button className="text-link" disabled={busy} onClick={()=>load()}>Refresh</button>}</div></div>
 {!DEPLOYMENT.factory?<div className="empty-state"><Layers size={30}/><h3>No deployed factory yet</h3><p>The feed reads registered Carve launches once deployment is verified.</p></div>:<>
 <div className="feed-filters"><label className="feed-search">Search launches<input value={filters.search} onChange={e=>set('search',e.target.value)} placeholder="Name, ticker, token or creator address"/></label>
 <label>Market<select value={filters.phase} onChange={e=>set('phase',e.target.value as LaunchFeedOptions['phase'])}><option value="all">All stages</option><option value="curve">Bonding curve</option><option value="v4">Uniswap v4</option></select></label>
 <label>Inscription<select value={filters.media} onChange={e=>set('media',e.target.value as LaunchFeedOptions['media'])}><option value="all">Any media</option><option value="image">Image</option><option value="audio">Sound</option><option value="website">Website</option><option value="complete">All three</option></select></label>
 <label>Creator fee<select value={filters.creatorFee} onChange={e=>set('creatorFee',e.target.value as LaunchFeedOptions['creatorFee'])}><option value="all">Any fee</option><option value="zero">0%</option><option value="upto1">Up to 1%</option><option value="upto5">Up to 5%</option><option value="above5">Above 5%</option></select></label>
 <label>Sort by<select value={filters.sort} onChange={e=>set('sort',e.target.value as LaunchFeedOptions['sort'])}>{[['newest','Newest'],['oldest','Oldest'],['marketcap-desc','Market cap: high to low'],['marketcap-asc','Market cap: low to high'],['volume-desc','Volume: high to low'],['volume-asc','Volume: low to high'],['progress-desc','Bonding: high to low'],['progress-asc','Bonding: low to high'],['reserve-desc','Reserve: high to low'],['reserve-asc','Reserve: low to high'],['fee-asc','Fee: low to high'],['fee-desc','Fee: high to low'],['name','Name A–Z']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label></div>
 <div className="feed-summary"><p>{visible.length} shown · {rows.length} loaded · {total.toString()} total Carve launches. Filters and sorting apply to loaded results.</p><button className="text-link" onClick={()=>setFilters({...DEFAULT_LAUNCH_FEED_OPTIONS})}>Reset filters</button></div>
 {!visible.length&&!busy&&!error&&<p>{rows.length?'No launches match these filters.':cursor&&cursor>0n?'No matching launches in this page. Load older launches below.':creator?'No launches by this wallet found.':'No tokens launched yet.'}</p>}
 <div className="launch-list launch-grid">{visible.map(row=><a className="launch-card market-card" key={row.token} href={'#/explore?token='+row.token}><div className="market-card-top"><TokenThumbnail registry={DEPLOYMENT.registry!} root={row.imageRoot} name={row.name} audio={row.hasAudio} website={row.hasWebsite}/><div className="market-identity"><strong>{row.name}</strong><span className="market-ticker">${row.symbol}</span><code>{short(row.token)}</code></div><ArrowUpRight size={18}/></div><div className="market-stage"><span className="status-tag">{row.phase===2?'UNISWAP V4':row.phase===0?'BONDING CURVE':'TRANSITIONING'}</span><span>{(row.creatorFee/100).toFixed(2)}% creator fee</span></div>
 <dl className="market-numbers"><div><dt>Market cap / FDV</dt><dd>{amountETH(row.marketCapETH)}</dd></div><div><dt>Lifetime pool volume</dt><dd>{amountETH(row.volumeETH)}</dd></div><div><dt>Bonding curve</dt><dd>{row.progressText===null?'Unavailable':row.phase===2?'100%':row.progressText.replace(/\.?0+$/,'')+'%'}</dd></div></dl>
 {row.curveProgressBps!==null&&<progress max={10000} value={row.curveProgressBps} aria-label={row.symbol+' bonding curve progress'}/>}
 <div className="market-card-bottom"><span>{[row.hasImage?'Image':'',row.hasAudio?'Sound':'',row.hasWebsite?'Website':''].filter(Boolean).join(' · ')}</span><span>{row.phase===2?'Liquidity permanently locked':amountETH(row.reserve)+' / 4.2 ETH'}</span></div><small>Read at block {row.block.toString()}{row.metricNote?' · Some metrics unavailable':''}</small></a>)}</div>
 {busy&&<p role="status">Reading registered launches and onchain market figures…</p>}{error&&<p className="error" role="alert">{error} Existing figures, if shown, are from their labelled blocks. Refresh to retry.</p>}{cursor!==null&&cursor>0n&&<button className="secondary" disabled={busy} onClick={()=>load('more')}>Load older launches</button>}
 <p className="muted">Values are in ETH. Market cap is fully diluted supply × current price—not a guaranteed sale value. New launches are checked every 5 seconds while this page is visible; recent market figures refresh every 20 seconds. Older cards retain their labelled snapshots. Volume excludes creation fees and refunds.</p></>}
 </section>;
}
