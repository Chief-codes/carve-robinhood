// User-approved deterministic cleanup: preserve the supplied jump/blink frames.
// Run with Sharp installed, or SHARP_MODULE pointing to an existing Sharp package.
import {createRequire} from 'node:module';
import {stat} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const sharp=require(process.env.SHARP_MODULE||'sharp');
const input='artwork/Carve-Jump-Blink.gif',output='src/assets/buddy/hello.gif';
const meta=await sharp(input,{animated:true}).metadata();
const width=256,frames=[];

// Flood from the border only. Warm ivory boots/eyes and enclosed highlights are
// preserved, unlike a global white-colour key. The neutral studio floor is removed.
async function clearBackground(data,w,h){
 const outside=new Uint8Array(w*h),queue=new Uint32Array(w*h);let tail=0;
 const visit=p=>{
  if(outside[p])return;
  const o=p*4,r=data[o],g=data[o+1],b=data[o+2];
  if(data[o+3]===0||(r>=175&&g>=175&&b>=170&&Math.abs(r-g)<8&&r-b<=18&&g-b<=18)){
   outside[p]=1;queue[tail++]=p;
  }
 };
 for(let x=0;x<w;x++){visit(x);visit((h-1)*w+x);}
 for(let y=1;y<h-1;y++){visit(y*w);visit(y*w+w-1);}
 for(let head=0;head<tail;head++){
  const p=queue[head],x=p%w,y=Math.floor(p/w);
  if(x)visit(p-1);if(x<w-1)visit(p+1);if(y)visit(p-w);if(y<h-1)visit(p+w);
 }
 // Rescue narrow light highlights inside ivory shoe outlines. Only bridge a
 // bounded horizontal run adjacent to warm foreground; never enlarge the outer
 // silhouette or join the green hands/body to the background.
 const warm=p=>{const o=p*4;return data[o]>190&&data[o]-data[o+1]>=3&&data[o]-data[o+2]>=14;};
 const soleRow=Math.floor(outside.findLastIndex(v=>!v)/w);
 for(let y=Math.max(0,soleRow-40);y<h;y++)for(let x=1;x<w-1;x++){
  const start=x;if(!outside[y*w+x]||outside[y*w+x-1])continue;
  while(x<w&&outside[y*w+x])x++;
  if(x<w&&x-start<=24&&(warm(y*w+start-1)||warm(y*w+x)))
   for(let k=start;k<x;k++)outside[y*w+k]=0;
 }
 for(let p=0;p<outside.length;p++)if(outside[p])data[p*4+3]=0;
 assert.ok(tail>w*h*.3,'Background detection failed');
 return data;
}
for(let i=0;i<meta.pages;i++){
 const {data,info}=await sharp(input,{page:i,pages:1}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 await clearBackground(data,info.width,info.height);
 if(i===0){
  assert.equal(data[(422*512+200)*4+3],255,'Preserve the light boots');
  assert.equal(data[(415*512+327)*4+3],255,'Preserve the toe highlight');
  assert.equal(data[3],0,'Remove the studio backdrop');
  await sharp(data,{raw:info}).webp({lossless:true}).toFile('src/assets/buddy/hello-still.webp');
 }
 frames.push(await sharp(data,{raw:info}).resize(width,width).raw().toBuffer());
}
await sharp(Buffer.concat(frames),{raw:{width,height:width*frames.length,channels:4,pageHeight:width}})
 .gif({effort:10,colours:256,dither:.5,loop:meta.loop,delay:meta.delay,keepDuplicateFrames:true})
 .toFile(output);
const result=await sharp(output,{animated:true}).metadata();
assert.equal(result.pages,meta.pages,'Do not discard any original animation frames');
assert.deepEqual(result.delay,meta.delay,'Preserve the exact jump/blink timing');
assert.equal(result.loop,meta.loop);
assert.equal(result.hasAlpha,true);
const pixels=await sharp(output,{animated:true}).ensureAlpha().raw().toBuffer();
for(let frame=0;frame<result.pages;frame++){
 const start=frame*width*width*4;let visible=0;
 for(const offset of [0,width-1,(width-1)*width,width*width-1])assert.equal(pixels[start+offset*4+3],0,'Every frame has transparent corners');
 for(let p=0;p<width*width;p++)if(pixels[start+p*4+3])visible++;
 assert.ok(visible>width*width*.05&&visible<width*width*.6,'Every frame retains the character, not the backdrop');
}
console.log(JSON.stringify({bytes:(await stat(output)).size,frames:result.pages,durationMs:result.delay.reduce((a,b)=>a+b,0),transparent:result.hasAlpha}));
