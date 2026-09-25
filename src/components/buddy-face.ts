/** Original 25-pose gaze compositor from the supplied Carve design archive.
 * Keep the artwork and registration unchanged: only the two eye windows animate.
 */
export type Eye={x:number;y:number;w:number;h:number};
export type FaceFrame={dx:number;dy:number;eyes:Eye[]};
export function gazeIndex(x:number,y:number){
 const clamp=(n:number)=>Math.max(-1,Math.min(1,n));
 return Math.round((clamp(y)+1)*2)*5+Math.round((clamp(x)+1)*2);
}
/** Original independent 230 ms sine blink, once every 5.4 seconds. */
export function buddyBlink(elapsed:number){
 const phase=((elapsed+4700)%5400+5400)%5400;
 return {amount:phase>5170?Math.sin((phase-5170)/230*Math.PI):0,delay:phase>=5170?16:Math.max(16,5170-phase)};
}
export type GazeAtlas={image:HTMLImageElement;frames:Eye[][]};
/** Isolate the two dominant opaque eye components in each cell, ignoring atlas noise. */
export function prepareGaze(image:HTMLImageElement):GazeAtlas{
 const cell=image.naturalWidth/5,frames:Eye[][]=[];
 for(let index=0;index<25;index++){
  const sx=index%5*cell,sy=Math.floor(index/5)*cell;
  const source=document.createElement('canvas');source.width=Math.ceil(cell);source.height=Math.ceil(cell);
  const c=source.getContext('2d',{willReadFrequently:true})!;c.drawImage(image,sx,sy,cell,cell,0,0,cell,cell);
  const {data,width,height}=c.getImageData(0,0,source.width,source.height),seen=new Uint8Array(width*height);
  const components:(Eye&{area:number})[]=[];
  for(let start=0;start<width*height;start++){
   if(seen[start]||data[start*4+3]<210)continue;
   const stack=[start];seen[start]=1;let minX=width,minY=height,maxX=0,maxY=0,area=0;
   while(stack.length){const i=stack.pop()!,x=i%width,y=Math.floor(i/width);area++;
    minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
    for(const next of [x>0?i-1:-1,x+1<width?i+1:-1,y>0?i-width:-1,y+1<height?i+width:-1])if(next>=0&&!seen[next]&&data[next*4+3]>=210){seen[next]=1;stack.push(next);}
   }
   if(area>200)components.push({x:minX,y:minY,w:maxX-minX+1,h:maxY-minY+1,area});
  }
  const pair=components.sort((a,b)=>b.area-a.area).slice(0,2).sort((a,b)=>a.x-b.x);
  const boxes=pair.length===2?pair:[{x:cell*.14,y:cell*.28,w:cell*.44,h:cell*.50},{x:cell*.61,y:cell*.35,w:cell*.30,h:cell*.42}];
  frames.push(boxes.map(e=>({x:sx+e.x+e.w*.04,y:sy+e.y+e.h*.035,w:e.w*.92,h:e.h*.93})));
 }
 return {image,frames};
}
export function drawGaze(ctx:CanvasRenderingContext2D,f:FaceFrame,gaze:GazeAtlas,index:number){
 for(let i=0;i<Math.min(2,f.eyes.length);i++){
  const eye=f.eyes[i],source=gaze.frames[index][i];
  ctx.save();ctx.translate(f.dx+eye.x*1.36,f.dy+eye.y*1.36);ctx.scale(1.36,1.36);
  ctx.beginPath();ctx.ellipse(eye.w/2,eye.h/2,eye.w/2,eye.h/2,0,0,Math.PI*2);ctx.clip();
  ctx.fillStyle='#f4ead6';ctx.fillRect(0,0,eye.w,eye.h);
  ctx.drawImage(gaze.image,source.x,source.y,source.w,source.h,0,0,eye.w,eye.h);
  ctx.restore();
 }
}


export function drawBuddyBlink(ctx:CanvasRenderingContext2D,f:FaceFrame,amount:number,leaning=false){
 if(amount<=0)return;
 for(const eye of f.eyes){
  ctx.save();ctx.translate(f.dx+eye.x*1.36,f.dy+eye.y*1.36);ctx.scale(1.36,1.36);
  ctx.beginPath();ctx.ellipse(eye.w/2,eye.h/2,eye.w/2+1,eye.h/2+1,0,0,Math.PI*2);ctx.clip();
  if(leaning)ctx.fillStyle='#03814d';
  else {const shade=ctx.createLinearGradient(0,0,eye.w,eye.h);shade.addColorStop(0,'#00643d');shade.addColorStop(1,'#058754');ctx.fillStyle=shade;}
  ctx.fillRect(-2,-2,eye.w+4,(eye.h+4)*amount);ctx.restore();
 }
}
