import {deformTexture} from '../../src/components/carveTextureMotion';
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
type Frame={image:HTMLCanvasElement;width:number;height:number;dx:number;dy:number;eyes:Eye[]};
const SOURCE_ROWS=[[0,322,626,934,1254],[0,319,625,938,1254],[0,329,650,950,1254]];

/** Find eye whites to register facial position and provide a separate idle blink. */
export function inspectFrame(image:HTMLImageElement,index:number,sheet:number):Frame{
 const size=sheet<0?image.naturalWidth:image.naturalWidth/4;
 const row=Math.floor(index/4),edges=sheet<0?[0,1254]:SOURCE_ROWS[sheet];
 const sx=(index%4)*size,sy=edges[row]*image.naturalHeight/1254,sourceHeight=(edges[row+1]-edges[row])*image.naturalHeight/1254;
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

type GazeAtlas={image:HTMLImageElement;frames:Eye[][]};
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
export function drawGaze(ctx:CanvasRenderingContext2D,f:Frame,gaze:GazeAtlas,index:number){
 for(let i=0;i<Math.min(2,f.eyes.length);i++){
  const eye=f.eyes[i],source=gaze.frames[index][i];
  ctx.save();ctx.translate(f.dx+eye.x*1.36,f.dy+eye.y*1.36);ctx.scale(1.36,1.36);
  ctx.beginPath();ctx.ellipse(eye.w/2,eye.h/2,eye.w/2,eye.h/2,0,0,Math.PI*2);ctx.clip();
  ctx.fillStyle='#f4ead6';ctx.fillRect(0,0,eye.w,eye.h);
  ctx.drawImage(gaze.image,source.x,source.y,source.w,source.h,0,0,eye.w,eye.h);
  ctx.restore();
 }
}
