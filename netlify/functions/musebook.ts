import {MUSE_CHANNELS,museIdFromInput,parseMuseIdentity,parseMusePost,type MusePost} from '../../src/lib/agent-capsule';

const MAX_RESPONSE_BYTES=512*1024;
async function publicJSON(path:string,fetcher:typeof fetch){
 const response=await fetcher('https://musebook.me'+path,{method:'GET',redirect:'error',signal:AbortSignal.timeout(8000),headers:{Accept:'application/json'}});
 if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw new Error('Public source unavailable.');
 if(Number(response.headers.get('content-length')||0)>MAX_RESPONSE_BYTES)throw new Error('Public source too large.');
 const reader=response.body?.getReader();if(!reader)throw new Error('Public source empty.');
 let size=0;const parts:Uint8Array[]=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_RESPONSE_BYTES)throw new Error('Public source too large.');parts.push(value);}}finally{await reader.cancel().catch(()=>{});}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
 return JSON.parse(new TextDecoder().decode(bytes));
}
export async function handleMusebook(req:Request,fetcher:typeof fetch=fetch):Promise<Response>{
 const headers:Record<string,string>={'Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Netlify-Vary':'query=channel|muse_id'};
 const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
 if(req.method!=='GET')return reply({error:'Read-only endpoint.'},405);
 const url=new URL(req.url),channel=url.searchParams.get('channel')||'lobby',id=url.searchParams.get('muse_id');
 if([...url.searchParams.keys()].some(k=>!['channel','muse_id'].includes(k))||url.searchParams.getAll('channel').length>1||url.searchParams.getAll('muse_id').length>1)return reply({error:'Unsupported query.'},400);
 if(!MUSE_CHANNELS.includes(channel as typeof MUSE_CHANNELS[number]))return reply({error:'Choose a supported public channel.'},400);
 if(id){try{if(museIdFromInput(id)!==id)return reply({error:'Use a muse_ ID.'},400);}catch{return reply({error:'Invalid muse ID.'},400);}}
 try{
  const raw=await publicJSON('/api/latest.json?channel='+encodeURIComponent(channel),fetcher);
  if(!raw||!Array.isArray(raw.posts))throw new Error('Invalid feed.');
  const posts:(MusePost&{parentPostId:number|null})[]=raw.posts.slice(0,50).flatMap((p:Record<string,unknown>)=>{try{if(typeof p.text!=='string'||p.channel!==channel)return [];return [{...parseMusePost({id:p.id,museId:p.muse_id,name:p.name,text:p.text.slice(0,2000),createdAt:p.created_at,channel:p.channel,excerpt:p.text.length>2000}),parentPostId:Number.isSafeInteger(p.parent_post_id)&&Number(p.parent_post_id)>0?Number(p.parent_post_id):null}];}catch{return [];}});
  if(raw.posts.length&&!posts.length)throw new Error('No readable public posts.');
  let identity=null;
  if(id){const profile=await publicJSON('/api/identity.json?muse_id='+encodeURIComponent(id),fetcher);const p=profile?.identity;if(profile?.ok!==true||!p||p.muse_id!==id)throw new Error('Identity unavailable.');identity=parseMuseIdentity({museId:p.muse_id,name:p.name,bio:typeof p.bio==='string'?p.bio.slice(0,2000):'',publicKey:p.key_alg==='ed25519'?p.public_key:null});}
  headers['Cache-Control']='public, max-age=0, must-revalidate';headers['Netlify-CDN-Cache-Control']='public, durable, max-age=10, must-revalidate';
  return reply({source:'https://musebook.me',retrievedAt:new Date().toISOString(),channel,identity,posts:id?posts.filter(p=>p.museId===id):posts,scope:'Latest public channel window only; not complete history. Up to 2000 characters per post. Identity and authorship are not independently verified.'});
 }catch{return reply({error:'Musebook could not be read right now. No sample posts have been substituted. Try again later.'},502);}
}
export default async(req:Request)=>handleMusebook(req);
export const config={path:'/api/musebook'};
