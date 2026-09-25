import {useEffect,useRef} from 'react';
import {ArrowRight,FileImage,AudioLines,Globe} from 'lucide-react';
import {createScrollMascot,scrollPose} from './CarveScrollMascot';
import './carve-introduction.css';
import {CarveLaunchDemo,createLaunchDemo} from './CarveLaunchDemo';
import {buddyAssets} from './buddy-runtime';

const clamp=(v:number)=>Math.max(0,Math.min(1,v));
const ease=(v:number)=>v*v*(3-2*v);

export function CarveIntroduction(){
 const root=useRef<HTMLElement>(null);
 const guidedScroll=useRef(0);
 useEffect(()=>{
  const section=root.current!;
  const stage=section.querySelector<HTMLElement>('.carve-scroll-stage')!;
  const first=section.querySelector<HTMLElement>('.carve-scene-one')!;
  const second=section.querySelector<HTMLElement>('.carve-scene-two')!;
  const third=section.querySelector<HTMLElement>('.carve-scene-three')!;
  const firstCue=section.querySelector<HTMLButtonElement>('.carve-story-scroll-first')!;
  const secondCue=section.querySelector<HTMLButtonElement>('.carve-story-scroll-next')!;
  const character=section.querySelector<HTMLElement>('.carve-traveller')!;
  const mascot=createScrollMascot(section.querySelector<HTMLCanvasElement>('.carve-pose-canvas')!);
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const demo=createLaunchDemo(third);
  let frame=0;
  const update=()=>{
   frame=0;
   // Focus must never scroll the clipped stage independently of the page.
   if(stage.scrollTop)stage.scrollTop=0;
   // 100vw includes classic scrollbars; use the usable viewport for full bleed.
   section.style.width=document.documentElement.clientWidth+'px';
   const rect=section.getBoundingClientRect();
   const w=stage.clientWidth,h=stage.clientHeight,small=w<700;
   const total=clamp(-rect.top/Math.max(1,section.offsetHeight-h));
   const p=clamp(total/.56);
   const exit=clamp((total-.60)/.055);
   const reveal=ease(clamp((total-.635)/.065));
   const arrival=clamp((total-.675)/.065);
   const q=clamp((total-.74)/.24);
   const puff=(t:number)=>Math.sin(Math.PI*t);
   const cloud=(el:HTMLElement,t:number)=>{
    el.style.opacity=String(reduced.matches?0:puff(t));
    el.style.transform=`scale(${.65+t*.75})`;
    el.style.setProperty('--puff-spread',String(t));
   };
   cloud(character.querySelector<HTMLElement>('.carve-poof')!,exit);
   cloud(third.querySelector<HTMLElement>('.carve-arrival-poof')!,arrival);
   character.querySelector<HTMLElement>('.carve-buddy-visual')!.style.opacity=String(1-ease(clamp((exit-.12)/.42)));
   stage.style.setProperty('--departure-opacity',String(1-ease(exit)));
   third.querySelector<HTMLElement>('.carve-computer-visual')!.style.opacity=String(ease(clamp((arrival-.15)/.45)));
   stage.style.setProperty('--third-opacity',String(reveal));
   stage.style.setProperty('--third-y',`${(1-reveal)*45}px`);
   third.inert=total<.69;third.setAttribute('aria-hidden',String(total<.69));
   character.setAttribute('aria-hidden',String(exit>.55));
   stage.dataset.scene=total<.60?'intro':total<.74?'transition':'tutorial';
   demo.update(q,total>.56&&rect.bottom>0&&rect.top<innerHeight);
   mascot.update(p,total<.66);
   const pose=scrollPose(p);
   const hop=ease(pose.jump),walk=pose.walk,magic=pose.magic;
   const size=Math.min(small?250:430,small?w*.60:w*.30,h*.48);
   const startX=w*(small?.71:.84)-size/2;
   const landX=w*(small?.29:.19)-size/2;
   const endX=w*(small?.50:.57)-size/2;
   const x=startX+(landX-startX)*hop+(endX-landX)*walk;
   const baseline=h*(small?.83:.90)-size;
   const lift=reduced.matches?0:Math.sin(hop*Math.PI)*h*.29;
   character.style.width=`${size}px`;
   character.style.transform=`translate3d(${x}px,${baseline-lift}px,0) rotate(${reduced.matches?0:Math.sin(hop*Math.PI)*-8}deg)`;
   stage.style.setProperty('--intro-opacity',String(1-ease(clamp(p/.25))));
   stage.style.setProperty('--hello-opacity',String(1-ease(clamp(p/.035))));
   stage.style.setProperty('--intro-y',`${-p*100}px`);
   stage.style.setProperty('--second-opacity',String(ease(clamp((p-.57)/.18))*(1-reveal)));
   stage.style.setProperty('--second-y',`${(1-ease(clamp((p-.57)/.18)))*45}px`);
   stage.style.setProperty('--weee-opacity',String(reduced.matches?0:Math.sin(hop*Math.PI)));
   stage.style.setProperty('--magic-opacity',String(ease(clamp((magic-.18)/.55))*(1-reveal)));
   stage.style.setProperty('--walk-caption-opacity',String(pose.phase==='walking-right'?Math.min(1,walk*16,(1-walk)*16):0));
   firstCue.hidden=p>.25;secondCue.hidden=p<.96||total>=.60;
   stage.style.setProperty('--progress',`${total*100}%`);
   first.inert=p>.25;second.inert=p<.65||total>.66;
   first.setAttribute('aria-hidden',String(p>.25));second.setAttribute('aria-hidden',String(p<.65||total>.66));
  };
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
  const cancelGuided=()=>cancelAnimationFrame(guidedScroll.current);
  window.addEventListener('wheel',cancelGuided,{passive:true});window.addEventListener('touchstart',cancelGuided,{passive:true});window.addEventListener('keydown',cancelGuided);
  update();window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule);reduced.addEventListener('change',schedule);
  return()=>{cancelAnimationFrame(guidedScroll.current);window.removeEventListener('wheel',cancelGuided);window.removeEventListener('touchstart',cancelGuided);window.removeEventListener('keydown',cancelGuided);demo.destroy();mascot.destroy();cancelAnimationFrame(frame);window.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule);reduced.removeEventListener('change',schedule);};
 },[]);
 const advance=(target=.55)=>{const el=root.current!;const stage=el.querySelector<HTMLElement>('.carve-scroll-stage')!;window.scrollTo({top:window.scrollY+el.getBoundingClientRect().top+(el.offsetHeight-stage.offsetHeight)*target,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});};
 const playStep=(target:number)=>{
  cancelAnimationFrame(guidedScroll.current);
  const el=root.current!,stage=el.querySelector<HTMLElement>('.carve-scroll-stage')!,start=window.scrollY;
  const span=el.offsetHeight-stage.offsetHeight,end=start+el.getBoundingClientRect().top+span*target;
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){window.scrollTo(0,end);return;}
  const duration=Math.max(500,Math.min(4000,Math.abs(end-start)/span/.06*4000)),began=performance.now();
  const tick=(now:number)=>{const t=clamp((now-began)/duration);window.scrollTo(0,start+(end-start)*t);if(t<1)guidedScroll.current=requestAnimationFrame(tick);};
  guidedScroll.current=requestAnimationFrame(tick);
 };
 const nextSection=()=>{document.getElementById('launch-now')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});};
 return <section className="carve-scroll-story" ref={root} aria-label="Meet Carve">
  <div className="carve-scroll-stage">
   <div className="carve-story-halo" aria-hidden="true"/>
   <div className="carve-scene-one">
    <div className="eyebrow">THE CREATOR-FIRST LAUNCHPAD ON ROBINHOOD CHAIN</div>
    <h1>Make culture.<br/><em>Keep it onchain.</em></h1>
    <p>Launch a token with its image, sound, and website stored permanently onchain.</p>
    <div className="home-actions"><a className="primary" href="#/studio">Create a token <ArrowRight size={17}/></a><a className="secondary" href="#/explore">Explore launches</a></div>
   </div>
   <div className="carve-scene-two">
    <div className="eyebrow">A LITTLE MAGIC. A LASTING MARK.</div>
    <h2>I’m <em>Carve.</em></h2>
    <p className="carve-intro-promise">You bring the spark.<br/>I help you make it permanent.</p>
    <p>Give your token a face, a sound, and a world of its own. Your creativity, written directly onchain.</p>
    <a className="primary" href="#/studio">Let’s make something <ArrowRight size={17}/></a>
   </div>
   <div className="carve-traveller">
    <span className="carve-travel-hello">Hello, I’m Carve.</span>
    <span className="carve-travel-weee">Weee!</span>
    <div className="carve-walk-caption" aria-hidden="true"><span>Follow a little magic</span><svg viewBox="0 0 90 65" fill="none"><path d="M78 4C82 33 53 22 48 42C46 49 43 54 32 56M32 56L37 44M32 56L46 58" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
    <div className="carve-poof" aria-hidden="true"><i/><i/><i/><i/><i/><i/><b>Poof!</b><span>✦</span></div>
    <div className="carve-buddy-visual"><img className="carve-buddy-fallback" src={buddyAssets.buddy} width="512" height="512" fetchPriority="high" decoding="async" alt="Carve, your onchain creative buddy"/><canvas className="carve-pose-canvas" width="512" height="512" role="img" aria-label="Carve jumps, walks to the center, and follows your pointer with his eyes once seated"/></div>
    <div className="carve-magic-sparkles" aria-hidden="true"><i>✦</i><i>✧</i><i>✦</i></div>
   </div>
   <div className="carve-conjured-media" aria-hidden="true"><span><FileImage/>Image</span><span><AudioLines/>Sound</span><span><Globe/>Website</span></div>
   <button className="carve-story-scroll carve-story-scroll-first" onClick={()=>advance()}>Scroll with Carve <span aria-hidden="true">↓</span></button>
   <button className="carve-story-scroll carve-story-scroll-next" onClick={()=>advance(.74)} hidden>Scroll with Carve <span aria-hidden="true">↓</span></button>
   <CarveLaunchDemo onAdvance={()=>{
    const el=root.current!,stage=el.querySelector<HTMLElement>('.carve-scroll-stage')!;
    const total=clamp(-el.getBoundingClientRect().top/(el.offsetHeight-stage.offsetHeight));
    const target=[.80,.86,.92,.98].find(t=>t>total+.008);
    if(target)playStep(target);else nextSection();
   }}/>
   <div className="carve-story-progress" aria-hidden="true"><span/></div>
  </div>
 </section>;
}
