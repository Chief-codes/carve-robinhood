/** Rigid cutout animation. Body and furniture are never transformed or resampled. */
import {buddyAssets,loadBuddyImage,visibleAnimation} from './buddy-runtime';
const SIZE=1254;
const nearArm=new Path2D('M 307 552 C 319 522 352 523 373 552 C 389 581 409 616 441 649 C 462 663 485 669 508 671 C 539 649 576 642 610 651 C 641 657 664 674 673 696 C 685 729 667 732 647 725 C 646 744 629 750 612 736 C 601 752 577 749 564 740 C 540 750 518 744 501 742 C 451 750 403 730 376 702 C 345 673 328 632 317 596 C 309 578 302 564 307 552 Z');
const farArm=new Path2D('M 779 564 C 799 566 817 589 828 620 C 853 628 872 648 876 678 C 880 703 863 711 850 700 C 841 719 823 715 816 707 C 799 720 780 715 773 704 C 756 714 733 709 722 693 C 711 681 722 651 744 635 C 758 626 773 621 785 619 C 785 602 779 584 779 564 Z');
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
const ease=(v:number)=>{const t=clamp(v);return t*t*t*(t*(t*6-15)+10);};
/** 480 interpolated in-between poses, seekable forwards and backwards with scrolling. */
export function computerPose(progress:number){
 const q=clamp(progress),mouse=ease((q-.30)/.12)*(1-ease((q-.68)/.12));
 const typing=1-mouse;
 const near=-.018+Math.sin(q*Math.PI*48)*.025*typing;
 const far=Math.sin(q*Math.PI*48+Math.PI)*.030;
 return {near:near+mouse*.235,far:far*(1-.65*mouse),lift:-Math.sin(ease((q-.30)/.12)*Math.PI)*10+Math.sin(ease((q-.68)/.12)*Math.PI)*-10,click:mouse*Math.max(0,Math.sin(q*Math.PI*64))*1.5,mouse};
}
const poses=Array.from({length:481},(_,i)=>computerPose(i/480));
export function createComputerMotion(canvas:HTMLCanvasElement){
 const ctx=canvas.getContext('2d')!,reduced=matchMedia('(prefers-reduced-motion: reduce)');canvas.width=canvas.height=SIZE;
 let original:HTMLImageElement,plate:HTMLImageElement,ready=false,loading=false,disposed=false,target=0,current=0,last=0,lastPaint=-1;
 const layer=(path:Path2D)=>{const c=document.createElement('canvas');c.width=c.height=SIZE;const x=c.getContext('2d')!;x.save();x.clip(path);x.drawImage(original,0,0,SIZE,SIZE);x.restore();return c;};
 let near:HTMLCanvasElement,far:HTMLCanvasElement;
 const paint=()=>{if(!ready||disposed)return;const key=reduced.matches?0:Math.round(current*480);if(key===lastPaint)return;lastPaint=key;
 const t=(reduced.matches?0:current)*480,index=Math.min(479,Math.floor(t)),f=t-index,a=poses[index],b=poses[index+1];
 const pose={near:a.near+(b.near-a.near)*f,far:a.far+(b.far-a.far)*f,lift:a.lift+(b.lift-a.lift)*f,click:a.click+(b.click-a.click)*f};
 ctx.clearRect(0,0,SIZE,SIZE);ctx.save();ctx.drawImage(plate,0,0,SIZE,SIZE);
 const arm=(image:HTMLCanvasElement,x:number,y:number,angle:number,lift:number)=>{ctx.save();ctx.translate(x,y+lift);ctx.rotate(angle);ctx.translate(-x,-y);ctx.drawImage(image,0,0);ctx.restore();};
 arm(far,790,591,pose.far,0);arm(near,341,561,pose.near,pose.lift+pose.click);
 ctx.restore();canvas.dataset.frame=String(Math.round(t));canvas.dataset.action=current>.42&&current<.68?'mouse':current>.30&&current<.80?'reach':'typing';};
 const loop=visibleAnimation(canvas,(now)=>{if(!ready||disposed)return;const dt=Math.min(40,now-last||16);last=now;current=reduced.matches?target:current+(target-current)*(1-Math.exp(-dt/75));if(Math.abs(target-current)<.00001)current=target;paint();return current!==target?16:undefined;});
 const load=()=>{if(loading)return;loading=true;Promise.all([loadBuddyImage(buddyAssets.computer),loadBuddyImage(buddyAssets.plate)]).then(([o,p])=>{if(disposed)return;original=o;plate=p;near=layer(nearArm);far=layer(farArm);ready=true;current=target;paint();canvas.dataset.ready='true';loop.wake();}).catch(()=>{canvas.dataset.animation='fallback';});};
 const changed=()=>{lastPaint=-1;loop.wake();};reduced.addEventListener('change',changed);
 return {update(q:number,active=true){const next=clamp(q),changed=target!==next;target=next;loop.setEnabled(active);if(active){load();if(changed)loop.wake();}},destroy(){disposed=true;loop.destroy();reduced.removeEventListener('change',changed);}};
}
