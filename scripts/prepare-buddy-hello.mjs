// Convert the original greeting animation; no new artwork or pose generation.
import {createRequire} from 'node:module';
import {stat} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const sharp=require(process.env.SHARP_MODULE||'sharp');
const input='public/brand/carve-wave.webp',output='src/assets/buddy/hello.gif';
const meta=await sharp(input,{animated:true}).metadata(),width=256,frames=[],delays=[];
// 10 fps retains the original wave/blink/holds without a multi-megabyte preview.
for(let i=0;i<meta.pages;i+=3){
 frames.push(await sharp(input,{page:i,pages:1}).resize(width,width).ensureAlpha().raw().toBuffer());
 delays.push(meta.delay.slice(i,i+3).reduce((a,b)=>a+b,0));
}
await sharp(Buffer.concat(frames),{raw:{width,height:width*frames.length,channels:4,pageHeight:width}}).gif({effort:10,colours:256,dither:0.7,loop:0,delay:delays}).toFile(output);
await sharp('public/brand/carve-wave-still.png').webp({lossless:true}).toFile('src/assets/buddy/hello-still.webp');
console.log('Buddy hello GIF:',(await stat(output)).size,'bytes');
