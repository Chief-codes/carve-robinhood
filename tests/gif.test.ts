import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectGif} from '../src/lib/gif';
const valid=Uint8Array.from(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAAKAAAALAAAAAABAAEAAAICRAEAOw==','base64'));
test('GIF parser counts frames and timing at structural block boundaries',()=>{
  assert.deepEqual(inspectGif(valid),{width:1,height:1,frames:1,duration:10,end:valid.length});
  assert.equal(inspectGif(Uint8Array.from([...valid,59,59])).end,valid.length);
});
test('GIF parser rejects truncated and invalid uploads',()=>{
  assert.throws(()=>inspectGif(valid.slice(0,-1)));
  assert.throws(()=>inspectGif(new Uint8Array(20)));
});
