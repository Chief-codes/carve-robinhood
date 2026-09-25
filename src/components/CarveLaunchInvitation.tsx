import {useEffect,useRef} from 'react';
import {ArrowUpRight} from 'lucide-react';
import {createLeaningGaze} from './CarveScrollMascot';
import {buddyAssets} from './buddy-runtime';
export function CarveLaunchInvitation(){
 const canvas=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{const cleanup=createLeaningGaze(canvas.current!),section=canvas.current!.closest('section')!;const observer=new IntersectionObserver(([entry])=>section.classList.toggle('invitation-visible',entry.isIntersecting),{threshold:.25});observer.observe(section);return()=>{cleanup();observer.disconnect();};},[]);
 return <section id="launch-now" className="carve-launch-invitation" aria-label="Launch with Carve"><div className="invitation-heading"><div className="eyebrow">YOU’VE SEEN THE MAGIC. NOW IT’S YOUR TURN.</div><h2>Your idea.<br/><em>Your next chapter.</em></h2></div><div className="invitation-action"><img className="carve-leaning-canvas carve-leaning-fallback" src={buddyAssets.leaning} width="512" height="512" loading="lazy" decoding="async" alt="Carve beside the launch button"/><canvas ref={canvas} className="carve-leaning-canvas" role="img" aria-label="Carve leaning beside the launch button and following your cursor"/><a className="invitation-launch-button" href="#/studio">Launch now <ArrowUpRight size={24}/></a><div className="invitation-caption" aria-hidden="true">Launch now<svg viewBox="0 0 330 120" fill="none"><path d="M310 8C195 8 215 88 20 92M20 92L43 76M20 92L43 108" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></div></div><p className="invitation-note">A face. A sound. A world of your own.</p></section>;
}
