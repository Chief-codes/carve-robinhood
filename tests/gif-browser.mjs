import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,channel:'chrome'});
try {
  const page=await browser.newPage();
  page.on('console',m=>console.log('browser:',m.type(),m.text()));
  await page.goto('http://127.0.0.1:5188/#/studio');
  const result=await page.evaluate(async()=>{
    const {compressGif,inspectGif}=await import('/src/lib/gif.ts');
    const bytes=[...new TextEncoder().encode('GIF89a'),0,1,0,1,247,0,0];
    for(let i=0;i<256;i++)bytes.push(i,(i*71)%256,(i*137)%256);
    bytes.push(33,255,11,...new TextEncoder().encode('NETSCAPE2.0'),3,1,0,0,0);
    for(let frame=0;frame<10;frame++){
      bytes.push(33,249,4,0,10,0,0,0,44,0,0,0,0,0,1,0,1,0,8);
      const data=[];let bits=0,bitCount=0,seed=frame+1;
      const code=n=>{bits|=n<<bitCount;bitCount+=9;while(bitCount>=8){data.push(bits&255);bits>>>=8;bitCount-=8;}};
      for(let n=0;n<65536;n++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;code(256);code(seed>>>24);}
      code(257);if(bitCount)data.push(bits&255);
      for(let n=0;n<data.length;n+=255){const block=data.slice(n,n+255);bytes.push(block.length,...block);}bytes.push(0);
    }
    bytes.push(59);const input=Uint8Array.from(bytes);
    const output=await compressGif(input,256);
    const info=inspectGif(output);
    return {input:input.length,output:output.length,...info};
  });
  assert.ok(result.input>1048576);
  assert.ok(result.output<=1048576);
  assert.ok(result.frames>1);
  assert.equal(result.duration,100);
  console.log(JSON.stringify(result));
}finally{await browser.close();}
