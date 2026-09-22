import {useEffect,useState} from 'react';
import {formatEther,type Address} from 'viem';
import {client,type Deployment} from '../lib/chain';
import {readBuybackStats,type BuybackSnapshot} from '../lib/buyback';

const amount=(v:bigint)=>v>0n&&v<10n**12n?'<0.000001':Number(formatEther(v)).toLocaleString(undefined,{maximumFractionDigits:6});
export function BuybackStats({market,deployment,symbol,refreshKey}:{market:Address;deployment:Deployment;symbol:string;refreshKey?:string}){
 const [data,setData]=useState<BuybackSnapshot|null>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true,busy=false;setData(null);setError('');
  const load=async()=>{if(busy||document.visibilityState==='hidden')return;busy=true;try{const next=await readBuybackStats(client,market,deployment);if(active){setData(next);setError('');}}catch{if(active){setData(null);setError('Buyback data unavailable. Retrying shortly.');}}finally{busy=false;}};
  void load();const timer=setInterval(load,15000);return()=>{active=false;clearInterval(timer);};
 },[market,deployment,refreshKey]);
 return <div className="curve-readout buyback-readout"><strong>Automatic buyback & burn</strong>{error?<p role="status">{error}</p>:!data?<p>Reading onchain settings…</p>:!data.enabled?<p>Not enabled for this token. Creator fees remain creator revenue.</p>:<><p>20% of creator fees → revenue · 80% → buyback & burn</p><dl className="review-details"><div><dt>Pending budget</dt><dd>{amount(data.pendingETH)} ETH</dd></div><div><dt>Pending token burn</dt><dd>{amount(data.pendingTokens)} {symbol}</dd></div><div><dt>ETH spent</dt><dd>{amount(data.spentETH)} ETH</dd></div><div><dt>Sent to dead address</dt><dd>{amount(data.burnedTokens)} {symbol}</dd></div></dl><small>Block {data.block.toString()} · Trade-triggered, not timed. Minimum ETH budget 0.00001. Extra gas applies. Nominal total supply is unchanged.</small></>}</div>;
}
