/** Parse block boundaries, never search compressed pixel bytes for a trailer. */
export function inspectGif(bytes: Uint8Array) {
  let p=13,frames=0,duration=0;
  const fail=()=>{throw new Error('Invalid or incomplete GIF. Export it again before uploading.');};
  const word=(n:number)=>bytes[n]|bytes[n+1]<<8;
  if(bytes.length<14||!/^GIF8[79]a$/.test(new TextDecoder().decode(bytes.slice(0,6))))fail();
  const width=word(6),height=word(8);
  if(!width||!height||width*height>4096*4096)throw new Error('GIF dimensions are too large. Export at 4096 × 4096 or smaller.');
  const skip=(n:number)=>{p+=n;if(p>bytes.length)fail();};
  const blocks=()=>{while(true){if(p>=bytes.length)fail();const n=bytes[p++];if(!n)break;skip(n);}};
  if(bytes[10]&128)skip(3*(1<<((bytes[10]&7)+1)));
  while(p<bytes.length){
    const marker=bytes[p++];
    if(marker===0x3b){if(!frames)fail();return {width,height,frames,duration,end:p};}
    if(marker===0x21){if(p>=bytes.length)fail();const type=bytes[p++];if(type===0xf9){if(p+6>bytes.length||bytes[p]!==4)fail();duration+=word(p+2);}blocks();}
    else if(marker===0x2c){if(p+9>bytes.length)fail();const fw=word(p+4),fh=word(p+6);if(!fw||!fh||word(p)+fw>width||word(p+2)+fh>height)fail();const packed=bytes[p+8];skip(9);if(packed&128)skip(3*(1<<((packed&7)+1)));skip(1);blocks();frames++;if(frames>600||width*height*frames>100_000_000)throw new Error('This GIF is too long or large to prepare safely. Shorten it or reduce its dimensions.');}
    else fail();
  }
  return fail();
}

// Pinned package embeds the encoder and WASM in a worker string. Own the worker
// lifecycle so an expensive input cannot leave an unbounded background job.
async function encodeGif(bytes:Uint8Array, command:string):Promise<Uint8Array> {
  const {default:encoder}=await import('gifsicle-wasm-browser');
  const url=URL.createObjectURL(new Blob([encoder.tool.workerLocalUrl],{type:'text/javascript'}));
  return new Promise((resolve,reject)=>{
    let worker:Worker;
    try{worker=new Worker(url);}catch(e){URL.revokeObjectURL(url);reject(e);return;}
    const finish=()=>{clearTimeout(timer);worker.terminate();URL.revokeObjectURL(url);};
    const timer=setTimeout(()=>{finish();reject(new Error('GIF preparation timed out. Try a shorter or smaller animation.'));},30_000);
    worker.onerror=()=>{finish();reject(new Error('GIF compression is unavailable in this browser. Try a smaller GIF.'));};
    worker.onmessage=e=>{finish();const output=Array.isArray(e.data)?e.data.find((f:{name:string})=>f.name==='prepared.gif'):null;output?.file?resolve(new Uint8Array(output.file)):reject(new Error('Could not compress this GIF. Export it again and retry.'));};
    worker.postMessage({data:[{name:'input.gif',file:Uint8Array.from(bytes).buffer}],command:[command],folder:[],isStrict:false});
  });
}
export async function compressGif(bytes:Uint8Array,dimension=256,limit=1024*1024):Promise<Uint8Array>{
  const original=inspectGif(bytes);
  let best:Uint8Array=bytes.slice(0,original.end);
  for(const [size,colors,loss] of [[dimension,128,30],[Math.min(dimension,192),64,60],[128,32,100]]){
    const result=await encodeGif(bytes,`-O1 --resize-fit ${size}x${size} --colors ${colors} --lossy=${loss} input.gif -o /out/prepared.gif`);
    const checked=inspectGif(result);
    if(checked.duration!==original.duration||(original.frames>1&&checked.frames<2))throw new Error('GIF animation could not be preserved. Please use another export.');
    if(result.length<best.length)best=result;
    if(best.length<=limit)return best;
  }
  throw new Error('GIF is still over 1 MB after compression. Shorten the animation and upload it again. Nothing has been sent onchain.');
}
