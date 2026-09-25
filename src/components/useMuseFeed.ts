import {useEffect,useRef,useState} from 'react';
import {parseMuseFeed,pollMuseFeed,type MuseFeed,type LiveStatus} from '../lib/muse-live';
export function useMuseFeed(channel:string,enabled:boolean){
 const [feed,setFeed]=useState<MuseFeed|null>(null),[status,setStatus]=useState<LiveStatus>('checking'),[error,setError]=useState('');
 const poll=useRef<ReturnType<typeof pollMuseFeed<MuseFeed>>|null>(null);
 useEffect(()=>{setFeed(null);setError('');},[channel]);
 useEffect(()=>{
  if(!enabled){setStatus('paused');return;}
  const next=pollMuseFeed(async signal=>{
   const response=await fetch('/api/musebook?channel='+encodeURIComponent(channel),{signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});
   const data=await response.json();if(!response.ok)throw new Error(typeof data.error==='string'?data.error:'Public source unavailable.');
   return parseMuseFeed(data,channel);
  },setFeed,(s,message)=>{setStatus(s);if(s==='live')setError('');else if(message)setError(message);});
  poll.current=next;return()=>{next.destroy();if(poll.current===next)poll.current=null;};
 },[channel,enabled]);
 return {feed:feed?.channel===channel?feed:null,status,error,refresh:()=>void poll.current?.refresh()};
}
