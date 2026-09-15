import {useEffect,useRef,useState} from 'react';
import {ImageOff,AudioLines,Code2,Image as ImageIcon} from 'lucide-react';
import {zeroHash,type Address,type Hex} from 'viem';
import {client} from '../lib/chain';
import {reconstructContent,validateMediaBytes} from '../lib/inscriptions';

// Immutable roots can be reused between cards without repeatedly fetching bytes.
// Keep the cache bounded; URLs belong to each mounted card and are revoked below.
const files=new Map<string,Promise<Awaited<ReturnType<typeof reconstructContent>>>>();
function imageFile(registry:Address,root:Hex){
 const key=registry.toLowerCase()+root.toLowerCase();let request=files.get(key);
 if(!request){request=reconstructContent(client,registry,root).then(file=>{validateMediaBytes({kind:'image',mime:file.mime,bytes:file.bytes});return file;}).catch(error=>{files.delete(key);throw error;});files.set(key,request);if(files.size>32)files.delete(files.keys().next().value!);}
 return request;
}
export function TokenThumbnail({registry,root,name,audio,website}:{registry:Address;root:Hex;name:string;audio:boolean;website:boolean}){
 const box=useRef<HTMLDivElement>(null),[url,setUrl]=useState(''),[failed,setFailed]=useState(false);
 useEffect(()=>{let active=true,objectURL='',started=false;setUrl('');setFailed(false);
  if(root===zeroHash)return;
  const start=()=>{if(started)return;started=true;imageFile(registry,root).then(file=>{if(!active)return;objectURL=URL.createObjectURL(new Blob([Uint8Array.from(file.bytes)],{type:file.mime}));setUrl(objectURL);}).catch(()=>{if(active)setFailed(true);});};
  const observer=typeof IntersectionObserver==='undefined'?null:new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){observer?.disconnect();start();}},{rootMargin:'120px'});
  if(observer&&box.current)observer.observe(box.current);else start();
  return()=>{active=false;observer?.disconnect();if(objectURL)URL.revokeObjectURL(objectURL);};
 },[registry,root]);
 const Icon=failed?ImageOff:root!==zeroHash?ImageIcon:audio?AudioLines:Code2;
 const label=failed?'Onchain image unavailable':root!==zeroHash?'Loading onchain image':audio?'Sound inscription':website?'Website inscription':'No image';
 return <div ref={box} className="launch-thumbnail" title={label}>{url&&!failed?<img src={url} alt={name+' onchain logo'} width={72} height={72} decoding="async" loading="lazy" onError={()=>setFailed(true)}/>:<Icon size={27} aria-label={label}/>}</div>;
}
