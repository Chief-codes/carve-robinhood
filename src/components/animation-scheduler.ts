/** No busy animation loop when offscreen, in a background tab or between blinks. */
export function visibleAnimation(target:Element,paint:(now:number)=>number|void){
 let raf=0,timer=0,disposed=false,intersecting=false,enabled=true;
 const stop=()=>{cancelAnimationFrame(raf);clearTimeout(timer);raf=0;timer=0;};
 const awake=()=>!disposed&&enabled&&intersecting&&!document.hidden;
 const tick=(now:number)=>{raf=0;if(!awake())return;const delay=paint(now);if(delay!==undefined&&awake()){if(delay<=17)raf=requestAnimationFrame(tick);else timer=window.setTimeout(wake,delay);}};
 const wake=()=>{stop();if(awake())raf=requestAnimationFrame(tick);};
 const observer=new IntersectionObserver(([entry])=>{intersecting=entry.isIntersecting;wake();});observer.observe(target);
 document.addEventListener('visibilitychange',wake);
 return {wake,setEnabled(value:boolean){if(value!==enabled){enabled=value;wake();}},destroy(){disposed=true;stop();observer.disconnect();document.removeEventListener('visibilitychange',wake);}};
}
