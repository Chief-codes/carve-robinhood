import {createComputerMotion} from './CarveComputerMotion';
import {ArrowRight} from 'lucide-react';
import {buddyAssets} from './buddy-runtime';
const titles=['Give it an identity','Add your media','Choose your settings','Review and approve'];
export function CarveLaunchDemo({onAdvance}:{onAdvance:()=>void}){
 return <section className="carve-scene-three carve-launch-scene" aria-label="Animated token launch walkthrough">
  <header className="carve-demo-heading"><div className="eyebrow">FROM AN IDEA TO ONCHAIN</div><h2>Let’s launch <em>something.</em></h2><p>Scroll along. I’ll show you how.</p></header>
  <div className="carve-demo-layout">
   <div className="carve-computer-scene"><div className="carve-computer-visual"><img className="carve-buddy-fallback" onError={e=>{if(!e.currentTarget.dataset.fallback){e.currentTarget.dataset.fallback="true";e.currentTarget.src=buddyAssets.buddy;}}} data-src={buddyAssets.computer} loading="lazy" width="900" height="900" alt="Carve at his computer"/><canvas className="carve-computer-canvas" width="512" height="512" role="img" aria-label="Carve seated on a chair working at a computer"/></div><div className="carve-arrival-poof carve-poof" aria-hidden="true"><i/><i/><i/><i/><i/><i/><b>Poof!</b><span>✦</span></div><span className="carve-computer-note">A little work. A little magic.</span></div>
   <div className="carve-demo-screen"><div className="carve-demo-screen-label"><span>CARVE / CREATE</span><span>ANIMATED EXAMPLE</span></div><video className="carve-launch-video" data-src="/tutorial/carve-launch-example.mp4" poster={buddyAssets.poster} preload="none" muted playsInline aria-label="Animated example: name your token, add media, choose settings, review and approve in your wallet"/><div className="carve-demo-timeline"><span/></div><ol className="carve-demo-steps">{titles.map((title,i)=><li key={title} data-step={i}><span>0{i+1}</span>{title}</li>)}</ol></div>
  </div>
  <div className="carve-demo-footer"><span className="carve-demo-caption">Scroll to follow the launch.</span><button className="primary carve-demo-advance" onClick={onAdvance}>Scroll with Carve <ArrowRight size={16}/></button></div>
 </section>;
}

export function createLaunchDemo(root:HTMLElement){
 const canvas=root.querySelector<HTMLCanvasElement>('.carve-computer-canvas')!,motion=createComputerMotion(canvas);
 const video=root.querySelector<HTMLVideoElement>('video')!;
 const steps=[...root.querySelectorAll<HTMLElement>('.carve-demo-steps li')];
 const caption=root.querySelector<HTMLElement>('.carve-demo-caption')!;
 let progress=0,disposed=false,active=false;
 const seek=()=>{if(disposed||!active||!Number.isFinite(video.duration)||video.seeking)return;const t=Math.min(Math.max(0,video.duration-.06),progress*16);if(Math.abs(video.currentTime-t)>.08)video.currentTime=t;};
 video.addEventListener('loadedmetadata',seek);video.addEventListener('seeked',seek);
 return {update(q:number,isActive=true){active=isActive;progress=Math.max(0,Math.min(1,q));motion.update(progress,active);if(active){const fallback=root.querySelector<HTMLImageElement>('.carve-buddy-fallback')!;if(!fallback.getAttribute('src'))fallback.src=fallback.dataset.src!;}if(active&&!video.getAttribute('src')){video.src=video.dataset.src!;video.preload='auto';video.load();}seek();const step=Math.min(3,Math.floor(progress*4));steps.forEach((el,i)=>{el.classList.toggle('is-current',i===step);el.classList.toggle('is-done',i<step);});root.style.setProperty('--demo-progress',`${progress*100}%`);root.dataset.demoProgress=progress.toFixed(3);caption.textContent=progress>=.99?'Your turn. Bring your idea to life.':`0${step+1} / ${titles[step]}`;},destroy(){disposed=true;motion.destroy();video.removeEventListener('loadedmetadata',seek);video.removeEventListener('seeked',seek);video.pause();video.removeAttribute('src');video.load();}};
}
