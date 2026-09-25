import {buddyBlink,drawBuddyBlink,drawGaze,gazeIndex,prepareGaze,type GazeAtlas} from './buddy-face';
import {deformTexture} from './carveTextureMotion';
import {buddyAssets,loadBuddyImage,visibleAnimation} from './buddy-runtime';
const clamp=(n:number)=>Math.max(0,Math.min(1,n));

/** Shared timeline keeps the world path and drawn pose in sync, in both directions. */
export function scrollPose(progress:number){
 const p=clamp(progress);
 if(p<.04)return {sheet:0,frame:15,phase:'standing',jump:0,walk:0,magic:0};
 if(p<.32){const t=clamp((p-.04)/.28);return {sheet:0,frame:Math.min(15,Math.floor(t*16)),phase:t<.25?'crouching':t<.75?'jumping':'landing',jump:clamp((t-.25)/.5),walk:0,magic:0};}
 if(p<.76){const t=clamp((p-.32)/.44);return {sheet:1,frame:Math.floor(t*48)%16,phase:'walking-right',jump:1,walk:t,magic:0};}
 const t=clamp((p-.76)/.20);
 return {sheet:2,frame:Math.min(15,Math.floor(t*16)),phase:t<.5?'sitting-down':t<1?'casting':'seated',jump:1,walk:1,magic:clamp((t-.5)*2)};
}

type Eye={x:number;y:number;w:number;h:number};
type Frame={image:HTMLCanvasElement;width:number;height:number;dx:number;dy:number;eyes:Eye[];base?:ImageData};
const SOURCE_ROWS=[[0,322,626,934,1254],[0,319,625,938,1254],[0,329,650,950,1254]];

/** Find eye whites to register facial position and provide a separate idle blink. */
export function inspectFrame(image:HTMLImageElement|HTMLCanvasElement,index:number,sheet:number):Frame{
 const imageWidth=image instanceof HTMLImageElement?image.naturalWidth:image.width,imageHeight=image instanceof HTMLImageElement?image.naturalHeight:image.height;
 const size=sheet<0?imageWidth:imageWidth/4;
 const row=Math.floor(index/4),edges=sheet<0?[0,1254]:SOURCE_ROWS[sheet];
 const sx=(index%4)*size,sy=edges[row]*imageHeight/1254,sourceHeight=(edges[row+1]-edges[row])*imageHeight/1254;
 const scratch=document.createElement('canvas');scratch.width=Math.ceil(size);scratch.height=Math.ceil(sourceHeight);
 const context=scratch.getContext('2d',{willReadFrequently:true})!;
 context.drawImage(image,sx,sy,size,sourceHeight,0,0,size,sourceHeight);
 const {data,width,height}=context.getImageData(0,0,scratch.width,scratch.height);
 let bottom=0,minAlphaX=width,maxAlphaX=0,torsoTotal=0,torsoX=0;const seen=new Uint8Array(width*height),eyes:Eye[]=[];
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;if(data[i+3]>190){bottom=Math.max(bottom,y);minAlphaX=Math.min(minAlphaX,x);maxAlphaX=Math.max(maxAlphaX,x);if(y>size*.22&&y<size*.70&&data[i+1]>data[i]*1.3&&data[i+1]>data[i+2]*1.1){torsoX+=x;torsoTotal++;}}}
 const isEye=(x:number,y:number)=>{if(x<0||x>=width||y<size*.22||y>size*.66)return false;const i=(y*width+x)*4;return data[i+3]>200&&data[i]>150&&data[i+1]>130&&data[i]>data[i+1]&&data[i+1]>data[i+2]+5;};
 for(let y=Math.ceil(size*.22);y<size*.66;y++)for(let x=0;x<width;x++){
  if(seen[y*width+x]||!isEye(x,y))continue;
  const queue=[[x,y]];seen[y*width+x]=1;let minX=x,maxX=x,minY=y,maxY=y;
  for(let n=0;n<queue.length;n++){const [xx,yy]=queue[n];minX=Math.min(minX,xx);maxX=Math.max(maxX,xx);minY=Math.min(minY,yy);maxY=Math.max(maxY,yy);
   for(const [nx,ny] of [[xx+1,yy],[xx-1,yy],[xx,yy+1],[xx,yy-1]])if(isEye(nx,ny)&&!seen[ny*width+nx]){seen[ny*width+nx]=1;queue.push([nx,ny]);}
  }
  if(queue.length>80&&maxY-minY>15&&maxX-minX>8)eyes.push({x:minX,y:minY,w:maxX-minX+1,h:maxY-minY+1});
 }
 eyes.sort((a,b)=>b.w*b.h-a.w*a.h);eyes.splice(2);eyes.sort((a,b)=>a.x-b.x);
 const centerX=torsoTotal?torsoX/torsoTotal:(minAlphaX+maxAlphaX)/2;
 // Constant scale preserves crouching/sitting height; only translation is registered.
 const scale=1.36;
 return {image:scratch,width:scratch.width,height:scratch.height,dx:Math.max(12-minAlphaX*scale,Math.min(500-maxAlphaX*scale,256-centerX*scale)),dy:480-bottom*scale,eyes};
}

export function createScrollMascot(canvas:HTMLCanvasElement){
 const ctx=canvas.getContext('2d',{willReadFrequently:true})!;
 canvas.width=512;canvas.height=512;
 const finePointer=matchMedia('(hover: hover) and (pointer: fine)'),reduced=matchMedia('(prefers-reduced-motion: reduce)');
 let progress=0,disposed=false,lastKey='',lastTime=performance.now(),gazeX=0,gazeY=0;
 let fallback:HTMLImageElement|null=null;
 let gaze:GazeAtlas|null=null,gazeRequested=false;
 const sheets:(HTMLImageElement|undefined)[]=[],frames=new Map<string,Frame>(),requested=new Set<number>();
 const pointer={x:0,y:0,inside:false},started=performance.now();
 const paths=[buddyAssets.jump,buddyAssets.walk,buddyAssets.sit];
 const requestSheet=(index:number)=>{
  if(requested.has(index))return;requested.add(index);
  loadBuddyImage(paths[index]).then(image=>{if(!disposed){sheets[index]=image;loop.wake();}}).catch(()=>{if(!disposed)canvas.dataset.animation='fallback';});
 };
 const prepare=()=>{
  // First paint never waits for atlases; restore the original standing pose next.
  const pose=scrollPose(progress);requestSheet(pose.sheet);
  if(progress>.12)requestSheet(1);
  if(progress>.58)requestSheet(2);
  if(progress>.58&&!gazeRequested){gazeRequested=true;loadBuddyImage(buddyAssets.eyes).then(image=>{if(!disposed){gaze=prepareGaze(image);loop.wake();}}).catch(()=>{});}
 };
 const loop=visibleAnimation(canvas,(now)=>{
  if(disposed)return;
  const pose=scrollPose(progress),si=reduced.matches?(progress<.5?0:2):pose.sheet;
  const fi=reduced.matches?15:si===0&&pose.frame===0?15:pose.frame;
  const frameKey=si+':'+fi,image=sheets[si];
  if(!image){
   if(!canvas.dataset.ready&&fallback){ctx.drawImage(fallback,0,0,512,512);canvas.dataset.ready='true';canvas.dataset.pose='standing';}
   return;
  }
  // Inspect only the frame being displayed, never 48 frames in one blocking task.
  let f=frames.get(frameKey);
  if(!f){f=inspectFrame(image,fi,si);frames.set(frameKey,f);}
  const idle=pose.phase==='standing'||pose.phase==='seated',clock=buddyBlink(now-started);
  const blink=!reduced.matches&&idle?clock.amount:0;
  const tracking=pose.phase==='seated'&&finePointer.matches&&!reduced.matches&&pointer.inside;
  let targetX=0,targetY=0;
  if(tracking){
   const rect=canvas.getBoundingClientRect(),eye=f.eyes[0];
   const anchorX=rect.left+(f.dx+(eye?eye.x+eye.w:180)*1.36)*rect.width/512;
   const anchorY=rect.top+(f.dy+(eye?eye.y+eye.h/2:130)*1.36)*rect.height/512;
   targetX=Math.max(-1,Math.min(1,(pointer.x-anchorX)/(innerWidth*.28)));
   targetY=Math.max(-1,Math.min(1,(pointer.y-anchorY)/(innerHeight*.28)));
  }
  const delta=Math.min(50,now-lastTime);lastTime=now;const follow=1-Math.exp(-delta/85);
  if(pose.phase==='seated'&&!reduced.matches){gazeX+=(targetX-gazeX)*follow;gazeY+=(targetY-gazeY)*follow;}else{gazeX=0;gazeY=0;}
  const index=gazeIndex(gazeX,gazeY),showGaze=pose.phase==='seated'&&gaze!==null;
  const key=[frameKey,showGaze?index:'none',Math.round(blink*1000)].join(':');
  const moving=pose.phase==='seated'&&(Math.abs(targetX-gazeX)>.003||Math.abs(targetY-gazeY)>.003);
  const next=reduced.matches?undefined:moving?16:idle?Math.max(16,clock.delay):undefined;
  canvas.dataset.tracking=String(tracking);canvas.dataset.gaze=showGaze?String(index):'inactive';
  canvas.dataset.blink=String(Math.round(blink*100));
  if(key===lastKey)return next;
  lastKey=key;
  canvas.dataset.pose=pose.phase;canvas.dataset.frame=frameKey;
  // Repaint the untouched sprite, then only the original eye windows and blink.
  ctx.clearRect(0,0,512,512);ctx.drawImage(f.image,f.dx,f.dy,f.width*1.36,f.height*1.36);
  if(showGaze)drawGaze(ctx,f,gaze!,index);
  drawBuddyBlink(ctx,f,blink);
  canvas.dataset.ready='true';return next;
 });
 const move=(event:PointerEvent)=>{pointer.inside=event.pointerType==='mouse';if(pointer.inside){pointer.x=event.clientX;pointer.y=event.clientY;}if(progress>.95)loop.wake();};
 const leave=()=>{pointer.inside=false;loop.wake();};
 window.addEventListener('pointermove',move,{passive:true});window.addEventListener('pointerdown',move,{passive:true});document.documentElement.addEventListener('pointerleave',leave);window.addEventListener('blur',leave);reduced.addEventListener('change',leave);finePointer.addEventListener('change',leave);
 loadBuddyImage(buddyAssets.buddy).then(image=>{if(!disposed){fallback=image;loop.wake();}}).catch(()=>{});
 return {update(p:number,active=true){const changed=progress!==p;progress=p;loop.setEnabled(active);if(active){prepare();if(changed)loop.wake();}},destroy(){disposed=true;loop.destroy();window.removeEventListener('pointermove',move);window.removeEventListener('pointerdown',move);document.documentElement.removeEventListener('pointerleave',leave);window.removeEventListener('blur',leave);reduced.removeEventListener('change',leave);finePointer.removeEventListener('change',leave);frames.clear();}};
}

/** Load this later scene only near the viewport, and sleep between interactions. */
export function createLeaningGaze(canvas:HTMLCanvasElement){
 const ctx=canvas.getContext('2d',{willReadFrequently:true})!;canvas.width=768;canvas.height=768;
 let disposed=false,loading=false,frame:Frame|null=null,base:ImageData|null=null,x=0,y=0,lastPaint='',lastTime=performance.now();
 const pointer={x:0,y:0,inside:false},start=performance.now();
 const reduced=matchMedia('(prefers-reduced-motion: reduce)'),fine=matchMedia('(hover:hover) and (pointer:fine)');
 const load=()=>{
  if(loading)return;loading=true;
  loadBuddyImage(buddyAssets.leaning).then(image=>{
   if(disposed)return;
   // Inspect a small copy, but render directly from the full-resolution original.
   const scratch=document.createElement('canvas');scratch.width=314;scratch.height=314;scratch.getContext('2d')!.drawImage(image,0,0,314,314);
   frame=inspectFrame(scratch,0,-1);
   ctx.clearRect(0,0,768,768);ctx.drawImage(image,frame.dx*1.5,frame.dy*1.5,314*1.36*1.5,314*1.36*1.5);
   base=ctx.getImageData(0,0,768,768);canvas.dataset.ready='true';loop.wake();
  }).catch(()=>{});
 };
 const loop=visibleAnimation(canvas,(now)=>{
  load();if(!frame||!base)return;
  const f=frame,r=canvas.getBoundingClientRect(),tracking=pointer.inside&&fine.matches&&!reduced.matches;
  const tx=tracking?Math.max(-1,Math.min(1,(pointer.x-r.left-r.width*.52)/(innerWidth*.28))):0,ty=tracking?Math.max(-1,Math.min(1,(pointer.y-r.top-r.height*.36)/(innerHeight*.28))):0;
  const dt=Math.min(50,now-lastTime);lastTime=now;const follow=1-Math.exp(-dt/85);if(reduced.matches){x=0;y=0;}else{x+=(tx-x)*follow;y+=(ty-y)*follow;}
  canvas.dataset.gaze=String(gazeIndex(x,y));
  const clock=buddyBlink(now-start),blink=reduced.matches?0:clock.amount;
  canvas.dataset.blink=String(Math.round(blink*100));
  const paintKey=[Math.round(x*150),Math.round(y*150),Math.round(blink*100)].join(':');
  if(paintKey!==lastPaint){
   lastPaint=paintKey;
   // The friend’s leaning pose uses its native eye texture, with fixed boundaries.
   ctx.putImageData(deformTexture(base,f.eyes.map(e=>({x:(f.dx+(e.x+e.w*.5)*1.36)*1.5,y:(f.dy+(e.y+e.h*.53)*1.36)*1.5,rx:e.w*.68*1.5,ry:e.h*.68*1.5,dx:x*4*1.5,dy:y*3*1.5}))),0,0);
   ctx.save();ctx.scale(1.5,1.5);drawBuddyBlink(ctx,f,blink,true);ctx.restore();
  }
  return reduced.matches?undefined:Math.abs(tx-x)>.003||Math.abs(ty-y)>.003?16:Math.max(16,clock.delay);
 });
 const move=(e:PointerEvent)=>{if(e.pointerType==='mouse'){pointer.x=e.clientX;pointer.y=e.clientY;pointer.inside=true;loop.wake();}};
 const leave=()=>{pointer.inside=false;loop.wake();};
 window.addEventListener('pointermove',move,{passive:true});window.addEventListener('blur',leave);document.documentElement.addEventListener('pointerleave',leave);reduced.addEventListener('change',leave);
 return ()=>{disposed=true;loop.destroy();window.removeEventListener('pointermove',move);window.removeEventListener('blur',leave);document.documentElement.removeEventListener('pointerleave',leave);reduced.removeEventListener('change',leave);};
}
