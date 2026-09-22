// Tiny, local GIF example: an abstract signal ripple, not an uploaded inscription.
// GIF89a with a fixed emerald palette and bounded literal LZW blocks.
const size=64,frames=16,bytes:number[]=[...new TextEncoder().encode('GIF89a'),size,0,size,0,247,0,0];
for(let i=0;i<256;i++)bytes.push(Math.round(i*0.22),i,Math.round(i*0.55));
bytes.push(33,255,11,...new TextEncoder().encode('NETSCAPE2.0'),3,1,0,0,0);
for(let f=0;f<frames;f++){
 bytes.push(33,249,4,0,8,0,0,0,44,0,0,0,0,size,0,size,0,0,8);
 const data:number[]=[];let bits=0,count=0;
 const code=(n:number)=>{bits|=n<<count;count+=9;while(count>=8){data.push(bits&255);bits>>>=8;count-=8;}};
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const r=Math.hypot(x-31.5,y-31.5),wave=(Math.cos(r*0.65-f*Math.PI*2/frames)+1)/2;
  const glow=Math.pow(wave,8)*Math.max(0,1-r/43);
  code(256);code(Math.round(9+glow*246));
 }
 code(257);if(count)data.push(bits&255);
 for(let i=0;i<data.length;i+=255){const chunk=data.slice(i,i+255);bytes.push(chunk.length,...chunk);}bytes.push(0);
}
bytes.push(59);
export const sampleGifBytes=Uint8Array.from(bytes);
export const sampleGifURL='data:image/gif;base64,'+btoa(Array.from(sampleGifBytes,b=>String.fromCharCode(b)).join(''));
