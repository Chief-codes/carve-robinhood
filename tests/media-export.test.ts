import test from 'node:test';
import assert from 'node:assert/strict';
import {mediaDataURI,mediaExtension} from '../src/lib/media-export';
test('data URLs preserve binary bytes across chunk boundaries',()=>{for(const n of [1,8191,8192,8193,1048576]){const b=Uint8Array.from({length:n},(_,i)=>i%256),url=mediaDataURI('image/png',b);assert.ok(url.startsWith('data:image/png;base64,'));assert.deepEqual(Uint8Array.from(Buffer.from(url.split(',')[1],'base64')),b);}});
test('HTML export preserves Unicode and original scripts without executing them',()=>{const b=new TextEncoder().encode('<h1>Carve 🌐</h1><script>window.unsafe=true</script>');assert.deepEqual(Uint8Array.from(Buffer.from(mediaDataURI('text/html',b).split(',')[1],'base64')),b);});
test('media URL export rejects unsupported MIME injection and bad sizes',()=>{for(const mime of ['text/html;anything','application/javascript','image/svg+xml'])assert.throws(()=>mediaDataURI(mime,new Uint8Array([1])));assert.throws(()=>mediaDataURI('image/png',new Uint8Array()));assert.throws(()=>mediaDataURI('image/png',new Uint8Array(1048577)));assert.equal(mediaExtension('audio/mp4'),'m4a');assert.equal(mediaExtension('text/html'),'html');});
