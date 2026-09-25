import {useEffect,useRef,useState} from 'react';
import {ArrowRight,ArrowUpRight,Check,Download,FileCheck2,MessageSquare,RefreshCw,Search,PenLine,ChevronLeft} from 'lucide-react';
import {bytesLabel,download,exportDraft,isolatedHtml,type Draft} from '../lib/assets';
import {readLocal,saveLocal} from '../lib/storage';
import {CAPSULE_SCHEMA,MUSE_CHANNELS,attachmentBytes,capsuleJSON,museIdFromInput,parseCapsule,parseMuseIdentity,parseMusePost,parseSnapshot,prepareCapsule,readCapsuleHTML,selectSnapshotPosts,stageCapsule,type AgentCapsule,type CapsuleInput,type MusePost} from '../lib/agent-capsule';
import '../agents.css';
import '../muse-studio.css';
import {useMuseFeed} from './useMuseFeed';

const empty:CapsuleInput={name:'',purpose:'',personality:'',instructions:'',source:null};

export function CapsuleDetails({capsule}:{capsule:AgentCapsule}){
 return <div className="capsule-inspector"><div className="eyebrow">AGENT CAPSULE · PUBLIC RECORD</div><h3>{capsule.name}</h3><p>{capsule.purpose}</p><p className="muted">Blueprint / archive only. Byte verification does not verify the author, endorse its claims, or make this a running AI.</p>{capsule.source&&<p>Snapshot of <a href={'https://musebook.me/residents/'+capsule.source.identity.museId} target="_blank" rel="noreferrer">{capsule.source.identity.name} ↗</a> · {capsule.source.posts.length} public posts · captured {capsule.source.capturedAt}. No ownership or endorsement established.</p>}<div className="button-row"><button className="secondary" onClick={()=>download('carve-agent-capsule.json',capsuleJSON(capsule))}><Download size={15}/>Download configuration</button>{capsule.attachment&&<button className="secondary" onClick={()=>download('attached-website.html',Uint8Array.from(attachmentBytes(capsule)!), 'text/html')}>Download original website</button>}</div>{capsule.attachment&&<p className="muted">The attached website retains its original bytes. Unknown HTML may contain scripts; inspect its source before opening it.</p>}</div>;
}

export function AgentCapsules({draft,setDraft,ready}:{draft:Draft;setDraft:(d:Draft)=>void;ready:boolean}){
 const [form,setForm]=useState<CapsuleInput>(empty),[loaded,setLoaded]=useState(false),[saved,setSaved]=useState('Loading local workspace…'),[backup,setBackup]=useState<Draft|null>(null);
 const [prepared,setPrepared]=useState<Awaited<ReturnType<typeof prepareCapsule>>|null>(null),[preparing,setPreparing]=useState(false),[prepareError,setPrepareError]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[consent,setConsent]=useState(false),[bundle,setBundle]=useState(false);
 const [channel,setChannel]=useState<string>('lobby'),[museInput,setMuseInput]=useState(''),[feedError,setFeedError]=useState(''),[feedBusy,setFeedBusy]=useState(false),[cooldown,setCooldown]=useState(false);
 const [mode,setMode]=useState<'musebook'|'blueprint'>('musebook'),[review,setReview]=useState(false),[search,setSearch]=useState(''),[availablePosts,setAvailablePosts]=useState<MusePost[]>([]);
 const controller=useRef<AbortController|null>(null);
 const live=useMuseFeed(channel,mode==='musebook'&&!review&&!feedBusy),feed=live.feed;
 const mounted=useRef(true),request=useRef(0),formVersion=useRef(0),cooldownTimer=useRef<ReturnType<typeof setTimeout>|null>(null),currentDraft=useRef(draft);currentDraft.current=draft;
 const existing=draft.assets.website,existingCapsule=existing?readCapsuleHTML(existing.bytes):null;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;request.current++;controller.current?.abort();if(cooldownTimer.current)clearTimeout(cooldownTimer.current);};},[]);
 useEffect(()=>{if(!ready)return;let active=true;readLocal<unknown>('agent-capsule-form').then(value=>{
  if(!active)return;
  try{if(value&&typeof value==='object'){const v=value as CapsuleInput;const c=parseCapsule({...v,name:v.name||'Unfinished',purpose:v.purpose||'Unfinished',schema:CAPSULE_SCHEMA,createdAt:new Date().toISOString(),attachment:null});setForm({name:v.name===''?'':c.name,purpose:v.purpose===''?'':c.purpose,personality:c.personality,instructions:c.instructions,source:c.source});}else if(existingCapsule){const c=existingCapsule;setForm({name:c.name,purpose:c.purpose,personality:c.personality,instructions:c.instructions,source:c.source});}}catch{/* Invalid old local form never replaces the launch draft. */}
  setLoaded(true);setSaved('Local workspace · not published');
 }).catch(()=>{if(active){setLoaded(true);setSaved('Browser storage unavailable · download a copy');}});readLocal<Draft>('agent-capsule-last-backup').then(d=>{if(active&&d?.version===1)setBackup(d);}).catch(()=>{});return()=>{active=false;};},[ready]);
 useEffect(()=>{if(!loaded)return;const timer=setTimeout(()=>{saveLocal('agent-capsule-form',form).then(()=>{if(mounted.current)setSaved('Saved on this device · not published');}).catch(()=>{if(mounted.current)setSaved('Not saved · download a copy');});},400);return()=>clearTimeout(timer);},[form,loaded]);
 useEffect(()=>{
  let active=true;setPrepared(null);setConsent(false);setPrepareError('');setPreparing(false);
  if(!form.name.trim()||!form.purpose.trim())return;
  setPreparing(true);
  const timer=setTimeout(()=>{prepareCapsule(form,existing).then(p=>{if(active)setPrepared(p);}).catch(e=>{if(active)setPrepareError(e.message);}).finally(()=>{if(active)setPreparing(false);});},200);
  return()=>{active=false;clearTimeout(timer);};
 },[form,existing?.keccak]);
 useEffect(()=>{setBundle(false);},[existing?.keccak]);
 const edit=(patch:Partial<CapsuleInput>)=>{formVersion.current++;setConsent(false);setPrepared(null);setError('');setForm(f=>({...f,...patch}));};
 const loadFeed=async(id?:string)=>{
  if(!id){live.refresh();return;}
  controller.current?.abort();const abort=new AbortController();controller.current=abort;
  const version=++request.current,editVersion=formVersion.current;setFeedBusy(true);setFeedError('');setCooldown(true);if(cooldownTimer.current)clearTimeout(cooldownTimer.current);cooldownTimer.current=setTimeout(()=>{if(mounted.current)setCooldown(false);},5000);
  try{
   const response=await fetch('/api/musebook?channel='+encodeURIComponent(channel)+(id?'&muse_id='+encodeURIComponent(id):''),{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(20000)])});
   const data=await response.json();if(!response.ok)throw new Error(typeof data.error==='string'?data.error:'Public feed unavailable.');
   if(data.source!=='https://musebook.me'||data.channel!==channel||!Array.isArray(data.posts)||data.posts.length>50||!Number.isFinite(Date.parse(data.retrievedAt)))throw new Error('Invalid public feed response.');
   const posts=data.posts.map(parseMusePost);if(posts.some((p:MusePost)=>p.channel!==channel))throw new Error('Source channel mismatch.');
   if(!mounted.current||version!==request.current)return;
   if(id){const identity=parseMuseIdentity(data.identity);if(identity.museId!==id)throw new Error('Source identity mismatch.');if(!posts.length)throw new Error('This muse has no posts in the latest window for this channel. Choose another channel or muse.');
    if(editVersion!==formVersion.current)throw new Error('Your draft changed while loading. Choose the muse again when ready.');
    const source=parseSnapshot({identity,capturedAt:data.retrievedAt,channel,posts:posts.slice(0,8)});
    edit({name:identity.name.slice(0,64)+'',purpose:'A dated public archive of '+identity.name.slice(0,128)+' on Musebook.',personality:'',instructions:'',source});
    setAvailablePosts(posts);setReview(true);setMode('musebook');
   }
  }catch(e){if(mounted.current&&version===request.current){setFeedError(e instanceof Error?e.message:'Public feed unavailable.');}}
  finally{if(mounted.current&&version===request.current)setFeedBusy(false);}
 };
 const changeMode=(next:'musebook'|'blueprint')=>{controller.current?.abort();request.current++;setFeedBusy(false);setMode(next);setReview(next==='blueprint');setError('');};
 const choosePost=(id:number,selected:boolean)=>{
  if(!form.source)return;try{const ids=form.source.posts.map(p=>p.id);edit({source:selectSnapshotPosts(form.source,selected?[...ids,id]:ids.filter(value=>value!==id),availablePosts.length?availablePosts:form.source.posts)});}catch(e){setError((e as Error).message);}
 };
 const filteredPosts=feed?.posts.filter(p=>(p.name+' '+p.text).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))??[];
 const canAttach=ready&&Boolean(prepared)&&consent&&!busy&&!Boolean(existing&&!existingCapsule&&!bundle);
 const attach=async()=>{
  if(!prepared||!consent||!ready||busy||(existing&&!existingCapsule&&!bundle))return;
  const version=formVersion.current,websiteHash=existing?.keccak;setBusy(true);setError('');
  try{
   const before=currentDraft.current;
   if(before.assets.website?.keccak!==websiteHash)throw new Error('The website draft changed. Review the capsule again.');
   // Save a full recoverable copy before changing the existing website slot.
   await saveLocal('agent-capsule-backup:'+Date.now(),before);
   await saveLocal('agent-capsule-last-backup',before);
   if(!mounted.current)return;
   if(version!==formVersion.current||currentDraft.current.assets.website?.keccak!==websiteHash)throw new Error('The draft changed. Review the capsule again.');
   const next=stageCapsule(currentDraft.current,prepared.asset);
   await saveLocal('draft',next);
   if(!mounted.current)return;
   setDraft(next);location.hash='/studio';
  }catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Could not save a safe draft backup.');}finally{if(mounted.current)setBusy(false);}
 };
 return <div className="agents-page muse-studio">
  <section className="muse-heading"><div><div className="eyebrow">MUSEBOOK × CARVE</div><h1>Live conversations.<br/><em>Lasting records.</em></h1><p>Watch real public conversations from Musebook. Choose the posts worth preserving and inscribe a snapshot with your token.</p></div><div className="muse-heading-note"><FileCheck2 size={22}/><span>Live feed, no presets.<br/>Permanent snapshots after launch.</span></div></section>
  <ol className="muse-steps" aria-label="Inscription steps"><li className={!review?'current':'complete'}><span>{review?<Check size={16}/>:1}</span>Choose your source</li><li className={review?'current':''}><span>2</span>Review your record</li><li><span>3</span>Launch & verify</li></ol>
  <div className="muse-mode" aria-label="Record type"><button aria-pressed={mode==='musebook'} onClick={()=>{changeMode('musebook');setReview(false);}}><MessageSquare size={18}/>Live Musebook</button><button aria-pressed={mode==='blueprint'} onClick={()=>changeMode('blueprint')}><PenLine size={18}/>Write an agent profile</button></div>
  {!review&&mode==='musebook'?<section className="panel muse-browser">
   <div className="muse-section-heading"><div><h2>Live from Musebook</h2><p>Public messages and replies, refreshed automatically. No account needed to watch.</p></div><a className="text-link" href="https://musebook.me" target="_blank" rel="noreferrer">Visit Musebook <ArrowUpRight size={15}/></a></div>
   {form.name&&<div className="muse-resume"><span>Saved record: <strong>{form.name}</strong></span><button className="text-link" onClick={()=>{setMode(form.source?'musebook':'blueprint');setReview(true);}}>Continue editing <ArrowRight size={15}/></button></div>}
   <form className="muse-profile-search" onSubmit={e=>{e.preventDefault();try{void loadFeed(museIdFromInput(museInput));}catch(err){setFeedError((err as Error).message);}}}><label htmlFor="muse-profile">Muse profile link</label><div><input id="muse-profile" value={museInput} maxLength={200} placeholder="Paste a Musebook profile link or muse_ ID" onChange={e=>setMuseInput(e.target.value)}/><button className="primary" disabled={!museInput.trim()||feedBusy||cooldown||!loaded||busy}>Choose muse <ArrowRight size={16}/></button></div></form>
   <div className="muse-feed-toolbar"><label>Channel<select value={channel} disabled={feedBusy} onChange={e=>{controller.current?.abort();setChannel(e.target.value);setFeedError('');setSearch('');request.current++;}}>{MUSE_CHANNELS.map(c=><option key={c} value={c}>#{c}</option>)}</select></label><label className="muse-search-label"><span>Find a name or topic</span><div><Search size={17}/><input value={search} placeholder="Search these posts…" maxLength={120} onChange={e=>setSearch(e.target.value)}/></div></label><button className="secondary" disabled={feedBusy||live.status==='checking'} onClick={()=>live.refresh()}><RefreshCw size={16} className={live.status==='checking'?'spin':''}/>{live.status==='checking'?'Updating…':'Refresh'}</button></div>
   {feedError&&<div className="muse-empty" role="alert"><p>{feedError}</p><button className="secondary" disabled={feedBusy||cooldown} onClick={()=>loadFeed()}>Try again</button></div>}
   <div className={'muse-live-status '+live.status} role="status"><span aria-hidden="true"/>{live.status==='offline'?'Offline — reconnect to resume':live.status==='reconnecting'?'Reconnecting to Musebook…':live.status==='paused'?'Feed paused':live.status==='checking'?(feed?'Checking for new messages…':'Connecting to Musebook…'):'Auto-updating · every 15 seconds'}{feed&&<small>Last read {new Date(feed.retrievedAt).toLocaleTimeString()}</small>}</div>
   {live.error&&<p className="muse-fine-print" role="status">{live.error} {feed?'Showing the last loaded posts; retrying automatically.':'Retrying automatically. No preset conversations are substituted.'}</p>}
   {(!feed&&live.status==='checking'||feedBusy)&&<div className="muse-loading" role="status"><RefreshCw size={20} className="spin"/><span>{feedBusy?'Preparing this muse’s snapshot…':'Reading public conversations…'}</span></div>}
   {feed&&<><div className="muse-feed-meta"><span>{filteredPosts.length} messages · newest first</span><a href={'https://musebook.me/board/'+feed.channel} target="_blank" rel="noreferrer">Open channel ↗</a></div><div className="muse-feed-grid muse-live-list" aria-label="Public Musebook conversations" tabIndex={0}>{filteredPosts.map(p=><article key={p.id} className="muse-post" data-post-id={p.id}><div className="muse-post-head"><span className="muse-avatar" aria-hidden="true">{p.name.slice(0,1).toUpperCase()}</span><div><strong>{p.name}</strong><small>#{p.channel} · {p.createdAt} UTC</small></div></div>{p.parentPostId&&<a className="muse-reply-link" href={'https://musebook.me/p/'+p.parentPostId} target="_blank" rel="noreferrer">↳ Reply in conversation #{p.parentPostId}</a>}<p>{p.text}</p>{p.excerpt&&<small>Excerpt · full text at the source.</small>}<div className="button-row"><a href={'https://musebook.me/p/'+p.id} target="_blank" rel="noreferrer">Read original ↗</a><button className="secondary" disabled={feedBusy||cooldown||!loaded||busy} onClick={()=>loadFeed(p.museId)}>Choose this muse <ArrowRight size={14}/></button></div></article>)}</div>{!filteredPosts.length&&<div className="muse-empty">{search?'No posts match this search. Try another name or topic.':'No public posts in this channel’s latest window.'}</div>}</>}
   <p className="muse-fine-print">Live public feed from musebook.me, not Carve-generated chat. Checks every 15 seconds while visible; source updates, network delays and a 10-second shared cache may add latency. Latest window only, not full history. Inscribed snapshots do not change with the live feed.</p>
  </section>:<div className="muse-review-layout">
   <section className="panel capsule-editor" id="capsule-review">
    {mode==='musebook'&&<button className="text-link" onClick={()=>setReview(false)}><ChevronLeft size={16}/>Back to muses</button>}
    <div className="eyebrow">{form.source?'MUSEBOOK SNAPSHOT':'CREATOR-WRITTEN PROFILE'}</div><h2>{form.source?'Make this record yours.':'Give your idea an identity.'}</h2>
    <p>{form.source?'Review the exact posts and give the archive a title. You are preserving a snapshot, not claiming ownership of the muse.':'Write a reusable character profile and instructions. This is a blueprint, not a running AI or automated trader.'}</p>
    <fieldset disabled={!loaded||busy}><label>Record name<input maxLength={64} value={form.name} placeholder="Name your archive or profile" onChange={e=>edit({name:e.target.value})}/></label><label>What is this record about?<textarea maxLength={600} rows={2} value={form.purpose} placeholder="A short description for people viewing the inscription" onChange={e=>edit({purpose:e.target.value})}/></label><details className="capsule-extra"><summary>Personality & public instructions <span>optional</span></summary><label>Personality<textarea maxLength={600} rows={2} value={form.personality} placeholder="Tone, character and boundaries" onChange={e=>edit({personality:e.target.value})}/></label><label>Public instructions<textarea maxLength={6000} rows={4} value={form.instructions} placeholder="Instructions to preserve with the profile" onChange={e=>edit({instructions:e.target.value})}/></label></details></fieldset>
    {form.source&&<div className="capsule-source"><div className="muse-section-heading"><div><strong>{form.source.identity.name}</strong><p>{form.source.posts.length} posts selected · #{form.source.channel}</p></div><a href={'https://musebook.me/residents/'+form.source.identity.museId} target="_blank" rel="noreferrer">Profile ↗</a></div><details><summary>Choose & review posts <span>1–8 posts</span></summary><div className="muse-post-choices">{(availablePosts.length&&availablePosts[0]?.museId===form.source.identity.museId?availablePosts:form.source.posts).map(p=>{const selected=form.source!.posts.some(item=>item.id===p.id);return <label className="muse-post-choice" key={p.id}><input type="checkbox" checked={selected} disabled={busy||(selected&&form.source!.posts.length===1)||(!selected&&form.source!.posts.length>=8)} onChange={e=>choosePost(p.id,e.target.checked)}/><span><strong>Post #{p.id}{p.excerpt?' · excerpt':''}</strong><span>{p.text}</span></span></label>;})}</div></details><p className="muse-fine-print">Captured {new Date(form.source.capturedAt).toLocaleString()}. This fixed snapshot does not update when the source changes.</p><button className="text-link" disabled={busy} onClick={()=>{edit({source:null});setAvailablePosts([]);}}>Remove snapshot</button></div>}
    {existing&&!existingCapsule&&<label className="capsule-check capsule-keep-site"><input type="checkbox" disabled={busy} checked={bundle} onChange={e=>{setBundle(e.target.checked);setConsent(false);}}/><span>Keep my existing website as a downloadable attachment. The new record becomes its preview; the original file is preserved.</span></label>}
    {existingCapsule?.attachment&&<p className="muse-fine-print">Your original website attachment will be kept.</p>}
    <label className="capsule-check"><input type="checkbox" disabled={!prepared||busy} checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>I reviewed this content and have permission to publish it permanently onchain.</span></label>
    {prepareError&&<p className="error" role="alert">{prepareError}</p>}{error&&<p className="error" role="alert">{error}</p>}
    <button className="primary full" disabled={!canAttach} onClick={attach}>{busy?'Saving your draft…':'Continue to Create'}<ArrowRight size={17}/></button>
    <p className="muse-fine-print">Next: add your token details, image/GIF or sound, then review costs and approve in your wallet. Nothing is published yet.</p>
    <details className="capsule-extra"><summary>Downloads & draft backup</summary><div className="button-row"><button className="secondary" disabled={!prepared} onClick={()=>{if(prepared)download('agent-capsule.html',Uint8Array.from(prepared.asset.bytes),'text/html');}}><Download size={16}/>Download record</button>{backup&&<button className="text-link" onClick={()=>download('carve-before-capsule-draft.json',exportDraft(backup))}>Download previous draft</button>}</div></details>
   </section>
   <aside className="panel muse-record-preview"><div className="muse-section-heading"><h2>Your inscription</h2><span className="status-tag">LOCAL PREVIEW</span></div>{prepared?<><iframe title="Agent capsule preview" sandbox="" srcDoc={isolatedHtml(new TextDecoder().decode(prepared.asset.bytes))}/><div className="muse-record-meta"><span>{bytesLabel(prepared.asset.bytes.length)} · website slot</span><span><FileCheck2 size={15}/>Self-contained record</span></div></>:<div className="muse-empty"><FileCheck2 size={30}/><p>{preparing?'Preparing your record…':'Add a name and description to see your exact inscription.'}</p></div>}<p className="muse-fine-print" role="status">{saved}</p><p className="muse-fine-print">Image/GIF and sound slots remain available. After launch, use Explore → Verify inscription to reconstruct this record from the chain.</p></aside>
  </div>}
  <details className="muse-explained"><summary>What this feature does—and doesn’t do</summary><p>Carve preserves an agent profile or public Musebook snapshot in the token’s website inscription. It does not create AI conversations, register a muse, post to Musebook or trade for an agent. Source names do not establish ownership or endorsement. Publish only content you have permission to share, never secrets. Independent integration; launch and storage gas apply.</p><a className="text-link" href="#/docs">Read the verification guide <ArrowUpRight size={14}/></a></details>
 </div>;
}
