type Attempt={id:string;completed:boolean};
type Store={read:<T>(key:string)=>Promise<T|undefined>;save:(key:string,value:unknown)=>Promise<void>};
export async function openLaunchAttempt(store:Store,key:string,newId:()=>string){
 const existing=await store.read<Attempt>(key);
 if(existing&&!existing.completed)return existing;
 const next:Attempt={id:newId(),completed:false};await store.save(key,next);return next;
}
export async function completeLaunchAttempt(store:Store,key:string,id:string){
 const current=await store.read<Attempt>(key);
 if(current?.id===id)await store.save(key,{...current,completed:true});
}
export function launchAttemptSuffix(id?:string){
 if(id===undefined)return '';
 if(!/^[0-9a-f-]{36}$/i.test(id))throw new Error('Invalid launch attempt ID.');
 return ':attempt:'+id.toLowerCase();
}
